// ActivityWatch HTTP 客户端
// 从 src/scripts/aw-verify.ts 沉淀可复用的取数逻辑（不修改原脚本）
// 模式完全对齐：类型守卫 + fetch GET + bucket type 全称匹配

// aw-server 根地址：从环境变量 AW_URL 读，默认 http://localhost:5600
const AW_URL = process.env.AW_URL ?? 'http://localhost:5600';

// ====== 类型定义（与 aw-verify.ts 对齐）======

interface AwServerInfo {
  testing: boolean;
  version: string;
  hostname: string;
  uptime: number;
}

export interface AwBucket {
  id: string;
  type: string;
  client?: string;
  hostname?: string;
  created?: string;
}

// GET /api/0/buckets 返回：key 是 bucket_id，value 是 bucket 元信息
type AwBucketsResponse = Record<string, AwBucket>;

// event（window / afk 共用，data 内容因 type 而异）
export interface AwEvent {
  timestamp: string;
  duration: number; // 秒（浮点）
  data: Record<string, unknown>;
}

// ====== 类型守卫（复用 aw-verify.ts 模式）======

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

// ====== 校验解析 ======

function parseServerInfo(v: unknown): AwServerInfo {
  if (!isRecord(v)) { throw new Error('/api/0/info 返回非对象'); }
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

function parseBucket(v: unknown): AwBucket {
  if (!isRecord(v)) { throw new Error('bucket 返回非对象'); }
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

function parseBuckets(v: unknown): AwBucketsResponse {
  if (!isRecord(v)) { throw new Error('/api/0/buckets 返回非对象'); }
  const out: AwBucketsResponse = {};
  for (const [key, val] of Object.entries(v)) {
    out[key] = parseBucket(val);
  }
  return out;
}

function parseEvents(v: unknown): AwEvent[] {
  if (!Array.isArray(v)) { throw new Error('events 返回非数组'); }
  return v.map((e, i) => {
    if (!isRecord(e)) { throw new Error(`第 ${i} 条 event 非对象`); }
    const timestamp = asString(e.timestamp);
    const duration = asNumber(e.duration);
    if (timestamp === undefined || duration === undefined) {
      throw new Error(`第 ${i} 条 event 缺少 timestamp/duration`);
    }
    return { timestamp, duration, data: isRecord(e.data) ? e.data : {} };
  });
}

// ====== HTTP ======

// 对 aw-server 发 GET，返回校验前的原始 JSON
async function getJson(path: string): Promise<unknown> {
  const url = `${AW_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} <- ${url}`);
  }
  const body: unknown = await res.json();
  return body;
}

// ====== 对外 API ======

// 探活：GET /api/0/info，失败抛异常
export async function pingServer(): Promise<AwServerInfo> {
  const info = parseServerInfo(await getJson('/api/0/info'));
  return info;
}

// 发现 window + afk bucket
// bucket.type='currentwindow' → window；'afkstatus' → afk（锁定项，不用简称）
export async function discoverBuckets(): Promise<{ window: AwBucket; afk: AwBucket }> {
  const buckets = parseBuckets(await getJson('/api/0/buckets'));
  let windowBucket: AwBucket | undefined;
  let afkBucket: AwBucket | undefined;
  for (const b of Object.values(buckets)) {
    if (b.type === 'currentwindow') { windowBucket = b; }
    else if (b.type === 'afkstatus') { afkBucket = b; }
  }
  if (!windowBucket || !afkBucket) {
    throw new Error('未找到 window 或 afk bucket，请检查 aw-watcher-window/afk 是否运行');
  }
  return { window: windowBucket, afk: afkBucket };
}

// 取指定时间区间内某 bucket 的 events
// startMs/endMs 为 epoch ms，转 ISO 传给 aw-server
// limit=10000（锁定项，不用 0）
export async function fetchEvents(
  bucketId: string,
  startMs: number,
  endMs: number,
): Promise<AwEvent[]> {
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const q = `?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&limit=10000`;
  return parseEvents(
    await getJson(`/api/0/buckets/${encodeURIComponent(bucketId)}/events${q}`),
  );
}
