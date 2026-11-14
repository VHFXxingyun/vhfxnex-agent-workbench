const EVENT_CONTEXT =
  /活动|工作坊|会议|展会|赛事|迎新|招新|聚会|研讨会|活动策划|演出|event|workshop|conference|meetup/i;

const COUNT = String.raw`(?:\d+|[零〇一二三四五六七八九十百千万两]+|[数几](?:十|百|千))(?:\s*(?:多|余))?`;
const OPERATIONAL_FACTS = new RegExp(
  String.raw`(?:(?:${COUNT})\s*(?:名(?:参与者|参会者|志愿者|工作人员|主持人|学生|同学|观众|嘉宾|来宾|师生)?|位(?:参与者|参会者|志愿者|工作人员|主持人|学生|同学|观众|嘉宾|来宾|师生)?|人(?:参加|参与|到场|报名|左右|以上|以内|规模)?|组|个(?:人|参与者|参会者|同学|学生|站点?|摊位|岗位|场地|志愿者)|张|件|套|份|支|把|台|箱|人次))|(?:场地|容量|可容纳)[^。；;，,]{0,24}${COUNT}\s*(?:人|名|位|席|平方米)|(?:库存|物料|物资|共享资源)[^。；;，,]{0,24}${COUNT}\s*(?:张|件|套|份|支|把|台|箱)|(?:[\p{Script=Han}A-Za-z0-9_-]{1,10})(?:负责|担任|值守|守站)\s*(?:[\p{Script=Han}A-Za-z0-9_-]{1,12})|\d+\s+(?:participants|volunteers|staff|attendees|people|students|guests|groups|stations|items)|staff assignments|venue capacity\s*:?\s*\d+|inventory\s*:?\s*\d+`,
  "iu",
);
const FEASIBILITY_CHANGE_INTENT =
  /完善|细化|补充|优化|修改|调整|变更|更新|改成|活动|方案|现场|流程|安排|人数|人手|人员|分工|岗位|志愿者|参与者|场地|会场|容量|站点|物料|物资|库存|资源|规模/i;

/**
 * Require deterministic feasibility review only when an event-like goal also
 * includes concrete people, venue, or inventory facts that can be checked.
 * @param {string} context
 */
export function requiresExecutionFeasibilityCheck(context) {
  const text = String(context || "");
  return EVENT_CONTEXT.test(text) && OPERATIONAL_FACTS.test(text);
}

/**
 * Recheck saved operational facts when a continuation is likely to change the
 * event plan. Pure questions and unrelated edits do not add another review.
 * @param {string} instruction
 * @param {string} existingContext
 */
export function shouldReviewExistingExecutionFeasibility(instruction, existingContext) {
  return (
    FEASIBILITY_CHANGE_INTENT.test(String(instruction || "")) &&
    requiresExecutionFeasibilityCheck(existingContext)
  );
}
