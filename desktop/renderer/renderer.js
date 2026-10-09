// 渲染进程逻辑：调用 window.flexiguard IPC API，渲染任务列表 + 当日进度
// 原生 JS，无框架无构建

// 今日日期 YYYY-MM-DD（sv-SE locale 输出 ISO 格式）
function todayStr() {
  return new Date().toLocaleDateString('sv-SE');
}

// epoch ms → datetime-local 输入值（yyyy-MM-ddTHH:mm）
function msToInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local 值 → epoch ms
function inputToMs(val) {
  return new Date(val).getTime();
}

// 格式化时间显示
function fmtTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 状态徽章文本
function statusText(status) {
  const map = {
    pending: '待开始',
    running: '进行中',
    done: '已通过',
    suspect: '存疑',
    pending_makeup: '待补',
  };
  return map[status] || status;
}

// ====== 页面元素 ======
const elDate = document.getElementById('today-date');
const elVerified = document.getElementById('verified-minutes');
const elTarget = document.getElementById('target-minutes');
const elProgress = document.getElementById('progress-bar');
const elBadge = document.getElementById('met-badge');
const elTaskList = document.getElementById('task-list');
const elEmptyHint = document.getElementById('empty-hint');
const elDialog = document.getElementById('task-dialog');
const elForm = document.getElementById('task-form');
const elDialogTitle = document.getElementById('dialog-title');
const elBtnNew = document.getElementById('btn-new');
const elBtnCancel = document.getElementById('btn-cancel');

// 当前编辑模式：null=新建，string=编辑的 task id
let editingId = null;

// ====== 渲染 ======

// 渲染当日进度
function renderStats(stats) {
  const verified = stats ? stats.verified_minutes : 0;
  const target = stats ? stats.target_minutes : 480;
  const met = stats ? stats.met : 0;
  elVerified.textContent = verified;
  elTarget.textContent = target;
  elProgress.value = verified;
  elProgress.max = target;
  elBadge.textContent = met ? '已达标' : '未达标';
  elBadge.className = met ? 'badge badge-done' : 'badge badge-pending';
}

// 渲染任务列表
function renderTasks(tasks) {
  elTaskList.innerHTML = '';
  if (tasks.length === 0) {
    elEmptyHint.style.display = 'block';
    return;
  }
  elEmptyHint.style.display = 'none';
  for (const t of tasks) {
    const tr = document.createElement('tr');
    // 标题
    const tdTitle = document.createElement('td');
    tdTitle.textContent = t.title;
    tr.appendChild(tdTitle);
    // 计划时间
    const tdTime = document.createElement('td');
    tdTime.textContent = `${fmtTime(t.planned_start)} ~ ${fmtTime(t.planned_end)}`;
    tr.appendChild(tdTime);
    // 类别
    const tdCat = document.createElement('td');
    tdCat.textContent = t.category;
    tr.appendChild(tdCat);
    // 状态
    const tdStatus = document.createElement('td');
    const span = document.createElement('span');
    span.textContent = statusText(t.status);
    span.className = `badge badge-${t.status}`;
    tdStatus.appendChild(span);
    tr.appendChild(tdStatus);
    // verified_minutes
    const tdVer = document.createElement('td');
    tdVer.textContent = t.verified_minutes;
    tr.appendChild(tdVer);
    // 操作按钮
    const tdActions = document.createElement('td');
    tdActions.className = 'actions';
    const btnVerify = document.createElement('button');
    btnVerify.textContent = '核验';
    btnVerify.onclick = () => onVerify(t.id);
    tdActions.appendChild(btnVerify);
    const btnEdit = document.createElement('button');
    btnEdit.textContent = '编辑';
    btnEdit.onclick = () => onEdit(t);
    tdActions.appendChild(btnEdit);
    const btnDelete = document.createElement('button');
    btnDelete.textContent = '删除';
    btnDelete.className = 'btn-danger';
    btnDelete.onclick = () => onDelete(t.id);
    tdActions.appendChild(btnDelete);
    tr.appendChild(tdActions);
    elTaskList.appendChild(tr);
  }
}

// 刷新今日数据（任务列表 + 当日统计）
async function refresh() {
  const date = todayStr();
  elDate.textContent = date;
  try {
    const [tasks, stats] = await Promise.all([
      window.flexiguard.taskListByDate(date),
      window.flexiguard.getDailyStats(date),
    ]);
    renderTasks(tasks);
    renderStats(stats);
  } catch (e) {
    console.error('刷新失败:', e);
  }
}

// ====== 事件处理 ======

// 新建任务
elBtnNew.onclick = () => {
  editingId = null;
  elDialogTitle.textContent = '新建任务';
  elForm.reset();
  elForm.elements['category'].value = 'general';
  // 默认填当前时间 +1h
  const now = Date.now();
  elForm.elements['planned_start'].value = msToInput(now);
  elForm.elements['planned_end'].value = msToInput(now + 60 * 60 * 1000);
  elDialog.showModal();
};

// 取消
elBtnCancel.onclick = () => {
  elDialog.close();
};

// 提交表单（新建/编辑）
elForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(elForm);
  const start = inputToMs(fd.get('planned_start'));
  const end = inputToMs(fd.get('planned_end'));
  if (!start || !end || end <= start) {
    alert('时间无效：计划结束需晚于计划开始');
    return;
  }
  const input = {
    title: fd.get('title'),
    planned_start: start,
    planned_end: end,
    planned_minutes: Math.round((end - start) / 60000),
    category: fd.get('category') || 'general',
  };
  try {
    if (editingId) {
      await window.flexiguard.taskUpdate(editingId, input);
    } else {
      await window.flexiguard.taskCreate(input);
    }
    elDialog.close();
    await refresh();
  } catch (err) {
    alert('保存失败: ' + err);
  }
};

// 编辑任务
function onEdit(task) {
  editingId = task.id;
  elDialogTitle.textContent = '编辑任务';
  elForm.elements['title'].value = task.title;
  elForm.elements['planned_start'].value = msToInput(task.planned_start);
  elForm.elements['planned_end'].value = msToInput(task.planned_end);
  elForm.elements['category'].value = task.category;
  elDialog.showModal();
}

// 删除任务
async function onDelete(id) {
  if (!confirm('确认删除此任务？')) { return; }
  try {
    await window.flexiguard.taskDelete(id);
    await refresh();
  } catch (e) {
    alert('删除失败: ' + e);
  }
}

// 核验任务
async function onVerify(id) {
  try {
    const result = await window.flexiguard.verifyTask(id);
    if (result.error) {
      alert('核验失败: ' + result.error);
    } else {
      const r = result.result;
      alert(
        `核验完成\n状态: ${statusText(r.status)}\n有效工时: ${Math.round(r.verified_minutes)} 分钟\n` +
        `活跃率: ${r.checks.active_ratio.toFixed(3)}\n证据条数: ${result.evidenceCount}`
      );
    }
    await refresh();
  } catch (e) {
    alert('核验异常: ' + e);
  }
}

// ====== 初始化 ======
window.addEventListener('DOMContentLoaded', refresh);
