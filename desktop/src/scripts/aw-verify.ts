// ActivityWatch 接入实证脚本（S2）
// 目的：验证"取 events → 扣 AFK → 算有效工时"链路在真实 ActivityWatch 数据上成立。
// 独立用 node 运行，不依赖 Electron 环境；使用 Node 22 原生 fetch，不引入额外依赖。
// 运行：先 npm run build，再 npm run aw-verify（aw-server 需在 http://localhost:5600 可达）。

// aw-server 根地址：从环境变量 AW_URL 读，默认 http://localhost:5600
const AW_URL = process.env.AW_URL ?? 'http://localhost:5600';

// AFK event 中代表"离开键盘"的 status 值
// aw-watcher-afk 的 data.status 取值："afk"=离开键盘，"not-afk"=活跃
// 依据：ActivityWatch 官方文档 working-with-data 示例 filter_keyvals(afk_events, "status", ["not-afk"])
const AFK_AWAY_STATUS = 'afk';

// ====== 类型定义 ======

// GET /api/0/info 返回的服务器信息
interface AwServerInfo {
  testing: boolean;
  version: string;
  hostname: string;
  uptime: number;
}

// bucket 元信息
interface AwBucket {
  id: string;
  type: string;
  client?: string;
  hostname?: string;
  created?: string;
}

// GET /api/0/buckets 返回：key 是 bucket_id，value 是 bucket 元信息
type AwBucketsResponse = Record<string, AwBucket>;

// event（window / afk 共用，data 内容因 type 而异）
interface AwEvent {
  timestamp: string;
  duration: number;
  data: Record<string, unknown>;
}

// ====== 类型守卫 ======

// 判断未知值是否为普通对象（非 null、非数组）
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 把未知值安全地解析为 string（缺失/类型不符时回退 undefined）
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// 把未知值安全地解析为 number（缺失/类型不符时回退 undefined）
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

// 把任意错误规整成可读字符串
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// 校验 /api/0/info 返回值结构
function parseServerInfo(v: unknown): AwServerInfo {
  if (!isRecord(v)) {
    throw new Error('/api/0/info 返回非对象');
  }
  const version = asString(v.version);
  const hostname = asString(v.hostname);
  if (version === undefined || hostname === undefined) {
    throw new Error('/api/0/info 返回缺少 version/hostname 字段');
  }
  return {
    testing: v.testing === true,
    version,
    hostname,
    uptime: asNumber(v.uptime) ?? 0,
  };
}

// 校验单个 bucket 结构
function parseBucket(v: unknown): AwBucket {
  if (!isRecord(v)) {
    throw new Error('bucket 返回非对象');
  }
  const id = asString(v.id);
  const type = asString(v.type);
  if (id === undefined || type === undefined) {
    throw new Error('bucket 缺少 id/type 字段');
  }
  return {
    id,
    type,
    client: asString(v.client),
    hostname: asString(v.hostname),
    created: asString(v.created),
  };
}

// 校验 buckets 返回结构
function parseBuckets(v: unknown): AwBucketsResponse {
  if (!isRecord(v)) {
    throw new Error('/api/0/buckets 返回非对象');
  }
  const out: AwBucketsResponse = {};
  for (const [key, val] of Object.entries(v)) {
    out[key] = parseBucket(val);
  }
  return out;
}

// 校验 event 数组结构
function parseEvents(v: unknown): AwEvent[] {
  if (!Array.isArray(v)) {
    throw new Error('events 返回非数组');
  }
  return v.map((e, i) => {
    if (!isRecord(e)) {
      throw new Error(`第 ${i} 条 event 非对象`);
    }
    const timestamp = asString(e.timestamp);
    const duration = asNumber(e.duration);
    if (timestamp === undefined || duration === undefined) {
      throw new Error(`第 ${i} 条 event 缺少 timestamp/duration`);
    }
    return { timestamp, duration, data: isRecord(e.data) ? e.data : {} };
  });
}

// ====== HTTP ======

// 对 aw-server 发 GET，返回校验前的原始 JSON（unknown），保证 any 不外泄
async function getJson(path: string): Promise<unknown> {
  const url = `${AW_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} <- ${url}`);
  }
  const body: unknown = await res.json();
  return body;
}

// 秒 -> "X.X 秒（Y.YY 分钟）"
function fmt(sec: number): string {
  return `${sec.toFixed(1)} 秒（${(sec / 60).toFixed(2)} 分钟）`;
}

// ====== 主流程 ======

export async function main(): Promise<void> {
  // 步骤 1：探活
  console.log('===== 1. 探活 aw-server =====');
  let info: AwServerInfo;
  try {
    info = parseServerInfo(await getJson('/api/0/info'));
  } catch (e) {
    console.error(`无法连接 aw-server（${AW_URL}）：${errMsg(e)}`);
    console.error('请确认 aw-server 已启动且地址正确（可用 AW_URL 环境变量覆盖，例如 AW_URL=http://127.0.0.1:5600）。');
    throw new Error('aw-server 不可达');
  }
  console.log(`版本：${info.version}`);
  console.log(`主机名：${info.hostname}`);
  console.log(`uptime：${info.uptime}`);

  // 步骤 2：列出所有 bucket
  console.log('\n===== 2. 列出 buckets =====');
  const buckets = parseBuckets(await getJson('/api/0/buckets'));
  const windowBuckets: AwBucket[] = [];
  const afkBuckets: AwBucket[] = [];
  // bucket.type 对应 Event 数据结构类型名，非 watcher 简称
  // aw-watcher-window 的 bucket type = 'currentwindow'
  // aw-watcher-afk 的 bucket type = 'afkstatus'
  // 依据：ActivityWatch 官方 bucket.type 设计
  for (const b of Object.values(buckets)) {
    const mark = b.type === 'currentwindow' ? ' [window]' : b.type === 'afkstatus' ? ' [afk]' : '';
    console.log(`- ${b.id} | type=${b.type}${mark}`);
    if (b.type === 'currentwindow') {
      windowBuckets.push(b);
    } else if (b.type === 'afkstatus') {
      afkBuckets.push(b);
    }
  }
  if (windowBuckets.length === 0 || afkBuckets.length === 0) {
    console.error('\n未找到 window 或 afk bucket，请检查是否安装并运行了 aw-watcher-window / aw-watcher-afk。');
    throw new Error('缺少 window 或 afk bucket');
  }
  // 多数环境各自只有一个，取第一个
  const windowBucket = windowBuckets[0];
  const afkBucket = afkBuckets[0];
  console.log(`\n选用 window bucket：${windowBucket.id}`);
  console.log(`选用 afk bucket：${afkBucket.id}`);

  // 步骤 3：取最近 2 小时 events
  // 单变量验证：先无参数取（确认 watcher 有数据），再带正确参数取（确认 query 语法）
  console.log('\n===== 3a. 无参数取 events（验证 watcher 是否产生数据）=====');
  const windowRawAll = parseEvents(
    await getJson(`/api/0/buckets/${encodeURIComponent(windowBucket.id)}/events`),
  );
  const afkRawAll = parseEvents(
    await getJson(`/api/0/buckets/${encodeURIComponent(afkBucket.id)}/events`),
  );
  console.log(`window bucket 全量条数（默认 limit）：${windowRawAll.length}`);
  console.log(`afk bucket 全量条数（默认 limit）：${afkRawAll.length}`);
  if (windowRawAll.length > 0) {
    console.log(`最新 window event 时间戳：${windowRawAll[0].timestamp}`);
    console.log(`  app=${asString(windowRawAll[0].data.app) ?? '(无)'} | title=${asString(windowRawAll[0].data.title) ?? '(无)'}`);
  }
  if (afkRawAll.length > 0) {
    console.log(`最新 afk event 时间戳：${afkRawAll[0].timestamp} | status=${asString(afkRawAll[0].data.status) ?? '(无)'}`);
  }

  console.log('\n===== 3b. 带 start/end + limit 取最近 2 小时 events =====');
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  console.log(`时间区间：${startIso} ~ ${endIso}`);
  // limit=10000（足够大），不传 limit=0（被 aw-server 理解为"返回0条"）
  const q = `?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=10000`;
  const windowEvents = parseEvents(
    await getJson(`/api/0/buckets/${encodeURIComponent(windowBucket.id)}/events${q}`),
  );
  const afkEvents = parseEvents(
    await getJson(`/api/0/buckets/${encodeURIComponent(afkBucket.id)}/events${q}`),
  );

  // 步骤 4：打印 event 条数
  console.log('\n===== 4. event 条数 =====');
  console.log(`window events：${windowEvents.length} 条`);
  console.log(`afk events：${afkEvents.length} 条`);

  // 步骤 5：计算有效工时
  // window 总时长：所有 window event 的 duration 之和
  const windowTotalSec = windowEvents.reduce((s, e) => s + e.duration, 0);
  // afk 离开时长：status === AFK_AWAY_STATUS 的 duration 之和
  const afkAwaySec = afkEvents
    .filter((e) => e.data.status === AFK_AWAY_STATUS)
    .reduce((s, e) => s + e.duration, 0);
  // 有效工时 = window 总时长 - afk 离开时长（负则 clamp 0）
  let activeSec = windowTotalSec - afkAwaySec;
  let clamped = false;
  if (activeSec < 0) {
    activeSec = 0;
    clamped = true;
  }
  const activeMinutes = activeSec / 60;

  // 步骤 6：打印明细
  console.log('\n===== 5. 明细 =====');
  console.log(`window 总时长：${fmt(windowTotalSec)}`);
  console.log(`afk 离开总时长（按 status="${AFK_AWAY_STATUS}" 统计）：${fmt(afkAwaySec)}`);
  if (clamped) {
    console.log('注意：有效工时为负，已 clamp 到 0，请检查 window/afk 时间区间是否对齐。');
  }
  console.log(`有效工时：${fmt(activeSec)}`);

  console.log('\n----- window event 抽样（前 5 条）-----');
  const sample = windowEvents.slice(0, 5);
  if (sample.length === 0) {
    console.log('（无 window event）');
  } else {
    for (const e of sample) {
      const app = asString(e.data.app) ?? '(无 app)';
      const title = asString(e.data.title) ?? '(无 title)';
      console.log(`- [${e.duration.toFixed(1)}s] ${app} | ${title}`);
    }
  }

  // 步骤 7：结论
  const ok = activeMinutes > 0 && windowEvents.length > 0;
  console.log(`\n===== 结论 =====`);
  console.log(`链路验证：${ok ? '成立 ✓' : '不成立，需检查 watcher'}`);
}

// 直接运行入口：node dist/scripts/aw-verify.js
if (require.main === module) {
  main().catch((e: unknown) => {
    console.error('运行失败：', errMsg(e));
    process.exitCode = 1;
  });
}
