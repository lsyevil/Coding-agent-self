/**
 * 选人器里的用户标签：有部门就拼成「张三 · 技术部」，没填就还是「张三」。
 *
 * 给「新建任务」「新建日程」两个 Select 的 label 用。抽成公用函数而不是各写一遍：
 * 两份拷贝迟早分叉成两种分隔符，而消歧的前提正是各处看起来一致。
 * 「新建会话」是自绘的勾选列表，不走这里 —— 它把部门渲染成同款灰字单独放一列
 * （正好是原来 @username 的位置），并在部门为空时退回显示 @username。
 *
 * 这两个 Select 刻意**不**退回 @username：它们本来就只显示姓名，没有可丢的东西，
 * 加上用户名只是给所有人都添噪音；而会话列表原本有 @username，删掉就是净减少。
 *
 * 拼接放在前端、而「（已注销）」后缀放在服务端，是刻意的不对称 ——
 * 见 server/presenters.ts 里 AccountUser.department 的注释：后缀漏一处就是错误信息，
 * 部门漏一处只是少了个提示，且它在消息气泡等地方是纯噪音。
 */
export function userPickerLabel(u: { displayName: string; department?: string | null }): string {
  return u.department ? `${u.displayName} · ${u.department}` : u.displayName;
}
