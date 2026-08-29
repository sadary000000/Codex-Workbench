import type { RuntimeErrorInfo, RuntimeState } from "../shared/runtime-types.ts";
import type { NativeVisibleEventKind } from "../shared/native-event-normalizer.ts";

/**
 * Presentation-only labels. Native values remain in the runtime/read model
 * and are shown only through the explicit Developer / Diagnostics surface.
 */
export function defaultEventLabel(kind: NativeVisibleEventKind): string {
  return {
    user: "User",
    assistant: "Assistant",
    processing: "Thinking / Processing",
    command_tool: "Command / Tool",
    file: "File Change",
    web: "Web / Search",
    approval: "需要确认",
    system: "后台更新",
    unknown: "其他更新",
  }[kind];
}

export function shouldRenderDefaultEvent(kind: NativeVisibleEventKind): boolean {
  return kind !== "system";
}

export function runtimeStateLabel(state: RuntimeState): string {
  return {
    IDLE: "空闲",
    STARTING: "启动中",
    READY: "就绪",
    TURN_RUNNING: "运行中",
    WAITING_USER: "等待确认",
    DISCONNECTED: "已断开",
    RECOVERY_REQUIRED: "需要恢复",
    FAILED: "操作失败",
    CLOSED: "已关闭",
  }[state];
}

export function operationStatusLabel(label: string): string {
  return {
    "runtime.state": "运行状态已更新",
    "navigation.projects": "项目列表已更新",
    "navigation.threads": "对话列表已更新",
    "native-thread.create": "对话已创建",
    "native-thread.switch": "对话已切换",
    "thread.read": "对话内容已更新",
    "thread.pin": "置顶状态已更新",
    "turn.start": "消息已发送",
    "turn.interrupt": "已请求停止",
    "native.approval.response": "确认已提交",
    "project.create": "项目已创建",
    "map.status": "Map 状态已更新",
    "map.enable": "Conversation Map 已启用",
    "map.pause": "Conversation Map 已暂停",
    "map.resume": "Conversation Map 已恢复",
    "project-map.status": "Project Map 状态已更新",
    "project-map.enable": "Project Map 已启用",
    "project-map.pause": "Project Map 已暂停",
    "project-map.resume": "Project Map 已恢复",
    "project-map.update": "Project Map 已更新",
    "project-map.maintenance-read": "维护对话已读取",
  }[label] ?? "操作已完成";
}

export function userFacingErrorMessage(error: RuntimeErrorInfo): string {
  if (error.code === "WRITER_CONFLICT") return error.message;
  const code = error.code ?? "";
  if (code.startsWith("APP_SERVER") || code.includes("PROTOCOL") || code.includes("RPC")) {
    return "Codex 操作失败，请打开 Developer / Diagnostics 查看详细信息。";
  }
  return error.message;
}

// renderer.ts is currently the single renderer entrypoint. Keep these UI-only
// extensions browser-gated so projection helpers remain safe in Node tests.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  void import("./automation-governance-inspector.ts")
    .then(() => import("./automation-governance-actions.ts"));
}
