const NEW_PROJECT_TARGET =
  /(?:桌宠|桌面.{0,12}(?:定时器|工具|应用|程序|软件)|定时器|网页|网站|应用|小程序|程序|代码|源码|插件|游戏|脚本|app|web app|prototype|website|software)/i;
const NEW_PROJECT_ACTION =
  /(?:做|写|生成|开发|创建|制作|实现|构建|编写|搭建|create|build|develop|make|implement|write|code)/i;
const EXISTING_PROJECT_TARGET =
  /(?:代码|源码|网站|网页|应用|小程序|程序|桌宠|游戏|脚本|页面|主页|首页|登录|注册|按钮|输入框|表单|界面|样式|配色|颜色|主题|布局|组件|前端|后端|接口|数据库|功能|菜单|导航|链接|滚动|侧栏|面板|区域|html|css|javascript|react|next|website|webpage|web app|software|button|form|ui|layout|style|component|login|signup|scroll|panel|api)/i;
const PROJECT_CHANGE_ACTION =
  /(?:修改|改成|改为|更改|调整|修|修复|修好|解决|优化|完善|美化|增加|添加|加上|新增|移除|删除|替换|更换|更新|重构|重写|实现|支持|补上|补充|扩展|做成|接入|适配|fix|change|modify|adjust|repair|resolve|improve|optimi[sz]e|polish|add|remove|delete|replace|update|refactor|implement|support|adapt)/i;
const PROJECT_FAILURE =
  /(?:不能|无法|没法|不工作|不起作用|没反应|无响应|报错|错误|异常|失败|白屏|黑屏|崩溃|崩了|卡住|错位|不显示|显示异常|滚不动|滑不动|打不开|跑不起来|有问题|bug|error|crash|not working|doesn't work|cannot|can't)/i;
const START_PROJECT_ACTION =
  /(?:开始(?:制作|开发|编写|写代码|实现|构建|搭建)|继续(?:制作|开发|编写|写代码|实现|构建|搭建)|动手(?:制作|开发|写代码)|直接(?:制作|开发|编写|实现)|开工|开始做吧|开始制作吧|start(?:\s+)?(?:building|coding|developing))/i;

/**
 * Decide whether an Agent turn should create a new code artifact or update
 * the code project already saved in this workspace.
 * @param {string} input
 * @param {{ isContinuation?: boolean; hasExistingProject?: boolean; mustAddTask?: boolean; isSoftwareWorkspace?: boolean }} [context]
 * @returns {"create" | "update" | null}
 */
export function classifyProjectIntent(input, context = {}) {
  const text = String(input || "");
  if (context.isContinuation && context.mustAddTask) return null;
  if (context.isContinuation && context.hasExistingProject && EXISTING_PROJECT_TARGET.test(text)) {
    if (PROJECT_CHANGE_ACTION.test(text) || PROJECT_FAILURE.test(text)) return "update";
  }

  // A selected software route already contains the project intent. Short follow-ups such as
  // “开始制作吧” should start creating the deliverable instead of being treated as a no-op.
  if (
    context.isContinuation &&
    context.isSoftwareWorkspace &&
    !context.hasExistingProject &&
    START_PROJECT_ACTION.test(text)
  )
    return "create";

  return NEW_PROJECT_TARGET.test(text) && NEW_PROJECT_ACTION.test(text) ? "create" : null;
}
