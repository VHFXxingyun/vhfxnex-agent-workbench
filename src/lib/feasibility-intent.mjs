const EVENT_CONTEXT =
  /活动|工作坊|会议|展会|赛事|迎新|招新|聚会|研讨会|活动策划|演出|event|workshop|conference|meetup/i;

const OPERATIONAL_FACTS =
  /(?:(?:\d+|[一二三四五六七八九十两]+)\s*(?:名(?:参与者|志愿者|工作人员|主持人)?|位(?:参与者|志愿者|工作人员|主持人)?|人(?:参与者|到场|报名|左右)?|组|个(?:站点?|摊位|岗位|场地|志愿者)|张|件|套|份|支|把|台|箱|人次))|(?:场地|容量|可容纳)[^。；;，,]{0,24}(?:\d+|[一二三四五六七八九十两]+)\s*(?:人|名|位|席|平方米)|(?:库存|物料|物资|共享资源)[^。；;，,]{0,24}(?:\d+|[一二三四五六七八九十两]+)\s*(?:张|件|套|份|支|把|台|箱)|(?:[\p{Script=Han}A-Za-z0-9_-]{1,10})(?:负责|担任|值守|守站)\s*(?:[\p{Script=Han}A-Za-z0-9_-]{1,12})|\d+\s+(?:participants|volunteers|staff|attendees|groups|stations|items)|staff assignments|venue capacity\s*:?\s*\d+|inventory\s*:?\s*\d+/iu;

/**
 * Require deterministic feasibility review only when an event-like goal also
 * includes concrete people, venue, or inventory facts that can be checked.
 * @param {string} context
 */
export function requiresExecutionFeasibilityCheck(context) {
  const text = String(context || "");
  return EVENT_CONTEXT.test(text) && OPERATIONAL_FACTS.test(text);
}
