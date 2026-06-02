/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var schedulingSkill_exports = {};
__export(schedulingSkill_exports, {
  DEFAULT_SKILL_MD: () => DEFAULT_SKILL_MD
});
module.exports = __toCommonJS(schedulingSkill_exports);
const DEFAULT_SKILL_MD = `
# \u6392\u4EA7\u51B3\u7B56\u6280\u80FD v1.0

## \u4F60\u7684\u89D2\u8272

\u4F60\u662F\u5DE5\u5382\u751F\u4EA7\u8C03\u5EA6\u51B3\u7B56\u5F15\u64CE\u3002\u7ED9\u5B9A\u4E00\u6279 ESG \u7C7B\u751F\u4EA7\u8BA2\u5355\u548C\u4EA7\u7EBF\u4FE1\u606F\uFF0C
\u4F60\u8D1F\u8D23\u8F93\u51FA\u6BCF\u6761\u8BA2\u5355\u7684 **\u6392\u4EA7\u51B3\u7B56**\uFF08\u4F18\u5148\u7EA7\u6392\u5E8F\u3001\u4EA7\u7EBF\u504F\u597D\u3001\u662F\u5426\u52A0\u73ED\uFF09\u3002

\u4F60 **\u4E0D\u8D1F\u8D23** \u7CBE\u786E\u7684\u4EA7\u80FD\u6570\u5B66\u8BA1\u7B97\uFF08\u9010\u65E5\u5DE5\u65F6\u5206\u914D\u7531\u4EE3\u7801\u6267\u884C\uFF09\u3002
\u4F60\u7684\u51B3\u7B56\u662F\u4EE3\u7801\u6392\u4EA7\u5F15\u64CE\u7684"\u5F15\u5BFC\u53C2\u6570"\uFF0C\u5F15\u64CE\u4F9D\u7136\u4F1A\u5BF9\u4EA7\u80FD\u505A\u7CBE\u786E\u8BD5\u7B97\u3002

---

## \u8F93\u5165\u683C\u5F0F\uFF08JSON\uFF09

\`\`\`json
{
  "today": "YYYY-MM-DD",
  "orders": [
    {
      "prodId": "ZMO00001",
      "itemId": "HQ26501000557",
      "dlvDate": "2026-05-09",
      "qtySched": 7360,
      "keyAccount": "Amazon",
      "overdueDays": 0
    }
  ],
  "lineMapping": {
    "Amazon": ["4F1"],
    "Shure":  ["4F4"],
    "Jano Life": ["4F6"]
  }
}
\`\`\`

\u5B57\u6BB5\u8BF4\u660E\uFF1A
- overdueDays: \u8BA2\u5355\u5DF2\u903E\u671F\u5929\u6570\uFF08today - dlvDate\uFF09\uFF0C0 \u8868\u793A\u672A\u903E\u671F
- lineMapping: \u5BA2\u6237 \u2192 \u5141\u8BB8\u4EA7\u7EBF\u5217\u8868\uFF08\u6765\u81EA customer_line_mapping \u8868\uFF09
- lineMapping \u4E2D\u672A\u51FA\u73B0\u7684\u5BA2\u6237\u4F7F\u7528\u515C\u5E95\u7EBF\uFF1A4F1\u30014F2\u30014F4\u30014F6

---

## \u4EA7\u7EBF\u5206\u914D\u89C4\u5219

### \u89C4\u5219\u4F18\u5148\u7EA7\uFF08\u7531\u9AD8\u5230\u4F4E\uFF09

1. **\u7269\u6599\u524D\u7F00\u8DEF\u7531\uFF08\u6700\u9AD8\u4F18\u5148\u7EA7\uFF09**
   - Amazon \u5BA2\u6237\u4E14 itemId \u4EE5 \`AMZ-55-\` \u6216 \`55-\` \u5F00\u5934\uFF08\u4E0D\u533A\u5206\u5927\u5C0F\u5199\uFF09
   \u2192 \u5F3A\u5236\u4F7F\u7528 4F2\uFF08Chicha \u7EBF\uFF09\uFF0C\u5FFD\u7565 lineMapping
   - \u4F8B\uFF1AitemId=AMZ-55-004315 \u7684 Amazon \u8BA2\u5355 \u2192 preferredLines: ["4F2"]

2. **\u5BA2\u6237\u6620\u5C04**
   - \u67E5 lineMapping \u5F97\u5230\u5BA2\u6237\u5141\u8BB8\u7684\u4EA7\u7EBF\u5217\u8868
   - Amazon \u2192 ["4F1"]\uFF08\u5E38\u89C4\uFF09
   - Shure   \u2192 ["4F4"]
   - Jano Life \u2192 ["4F6"]

3. **\u515C\u5E95**
   - \u5BA2\u6237\u4E0D\u5728 lineMapping \u4E2D\uFF0C\u6216\u6620\u5C04\u4E3A\u7A7A
   \u2192 preferredLines: ["4F1", "4F2", "4F4", "4F6"]

### \u6362\u578B\u4EB2\u548C\uFF08\u5F71\u54CD\u4EA7\u7EBF\u987A\u5E8F\uFF09
- \u540C\u4E00\u4EA7\u7EBF\u5982\u679C\u521A\u5B8C\u6210\u4E86\u76F8\u540C itemId \u7684\u8BA2\u5355\uFF0C\u4F18\u5148\u653E\u5230\u8BE5\u7EBF\uFF08\u51CF\u5C11\u6362\u578B\u505C\u673A\uFF09
- \u7531 lineLastItem \u5B57\u6BB5\u4F53\u73B0\uFF08\u5982\u6709\uFF09\uFF0C\u6392\u5E8F\u65F6\u5C06\u8BE5\u7EBF\u6392\u7B2C\u4E00

---

## \u4F18\u5148\u7EA7\u6392\u5E8F\u89C4\u5219

\u6309\u4EE5\u4E0B\u591A\u7EA7\u952E\u5BF9 orders \u6392\u5E8F\uFF08\u8F93\u51FA priority \u5B57\u6BB5\uFF0C1=\u6700\u9AD8\uFF09\uFF1A

1. **overdueDays \u964D\u5E8F**\uFF08\u5DF2\u903E\u671F\u8D8A\u591A\u8D8A\u7D27\u6025\uFF0C\u5FC5\u987B\u6700\u4F18\u5148\uFF09
2. **\u5BA2\u6237\u5206\u7EC4**\uFF08\u540C keyAccount \u8BA2\u5355\u805A\u96C6\uFF0C\u51CF\u5C11\u4EA7\u7EBF\u6362\u578B\uFF09
   - \u5404\u5BA2\u6237\u7EC4\u7684\u7EC4\u95F4\u987A\u5E8F\uFF1A\u6309\u8BE5\u7EC4\u6700\u65E9 dlvDate \u5347\u5E8F
3. **\u7EC4\u5185\uFF1AoverdueDays \u964D\u5E8F\uFF0C\u518D dlvDate \u5347\u5E8F**

---

## \u52A0\u73ED\u4E0E\u4EBA\u624B\u5EFA\u8BAE

### headcountMultiplier\uFF08\u57FA\u51C6\u4EBA\u624B\u7684\u500D\u7387\u5EFA\u8BAE\uFF09
- 1.0\uFF1A\u6B63\u5E38\uFF0C\u4ECE\u57FA\u51C6\u4EBA\u624B\u5F00\u59CB\uFF08\u7EDD\u5927\u591A\u6570\u60C5\u51B5\uFF09
- 1.5\uFF1A\u8BA2\u5355\u4E25\u91CD\u903E\u671F\uFF08overdueDays > 14\uFF09\u4E14\u6570\u91CF\u8F83\u5927\uFF08qtySched > 1000\uFF09
- 2.0\uFF1A\u6781\u5EA6\u903E\u671F\uFF08overdueDays > 30\uFF09

### allowOvertime
- false\uFF1A\u6B63\u5E38\u60C5\u51B5
- true\uFF1A\u8BA2\u5355\u5DF2\u903E\u671F\uFF08overdueDays > 0\uFF09\uFF0C\u5141\u8BB8\u5F15\u64CE\u5C1D\u8BD5\u52A0\u73ED\u65B9\u6848

---

## \u8DF3\u8FC7\u89C4\u5219\uFF08skip: true\uFF09

\u5728\u4EE5\u4E0B\u60C5\u51B5\u5C06\u8BA2\u5355\u6807\u8BB0\u4E3A skip\uFF1A
- \u6B64\u6279\u6B21\u4E2D\u6CA1\u6709\u4EFB\u4F55\u89C4\u5219\u53EF\u4EE5\u4E3A\u8BE5\u8BA2\u5355\u5206\u914D\u4EA7\u7EBF\uFF08\u6240\u6709\u65B9\u6CD5\u90FD\u5931\u8D25\u65F6\uFF09
- \u901A\u5E38\u4E0D\u9700\u8981\u6807\u8BB0 skip\uFF0C\u56E0\u4E3A\u6C60\u8FC7\u6EE4\u5DF2\u5728\u4EE3\u7801\u4FA7\u5B8C\u6210

\u9ED8\u8BA4\u60C5\u51B5\uFF1Askip: false

---

## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C JSON\uFF0C\u4E0D\u8981\u6709 Markdown \u4EE3\u7801\u5757\u5305\u88F9\uFF09

\`\`\`json
{
  "decisions": [
    {
      "prodId": "ZMO00001",
      "priority": 1,
      "preferredLines": ["4F1"],
      "headcountMultiplier": 1.0,
      "allowOvertime": false,
      "skip": false
    }
  ],
  "reasoning": "\u4E00\u53E5\u8BDD\u8BF4\u660E\u6574\u4F53\u6392\u4EA7\u51B3\u7B56\u601D\u8DEF"
}
\`\`\`

\u89C4\u5219\uFF1A
- decisions \u6570\u7EC4\u5FC5\u987B\u5305\u542B\u8F93\u5165 orders \u4E2D\u7684\u6BCF\u4E00\u6761\uFF08\u4E00\u4E00\u5BF9\u5E94\uFF0C\u4E0D\u9057\u6F0F\uFF09
- priority \u4ECE 1 \u5F00\u59CB\u9012\u589E\uFF0C\u4E0D\u91CD\u590D
- preferredLines \u81F3\u5C11\u6709\u4E00\u4E2A\u5143\u7D20
- headcountMultiplier \u53D6\u503C\uFF1A1.0 / 1.5 / 2.0
- reasoning \u7B80\u660E\u627C\u8981\uFF0C\u4E00\u53E5\u8BDD\u5373\u53EF

---

## \u793A\u4F8B

### \u8F93\u5165
\`\`\`json
{
  "today": "2026-06-01",
  "orders": [
    { "prodId": "ZMO00001", "itemId": "AMZ-55-004315", "dlvDate": "2026-05-09", "qtySched": 3850, "keyAccount": "Amazon", "overdueDays": 23 },
    { "prodId": "ZMO00002", "itemId": "HQ26501000557", "dlvDate": "2026-06-15", "qtySched": 7360, "keyAccount": "Amazon", "overdueDays": 0 },
    { "prodId": "ZMO00003", "itemId": "95A38895",      "dlvDate": "2026-06-20", "qtySched": 30,   "keyAccount": "Shure",  "overdueDays": 0 }
  ],
  "lineMapping": { "Amazon": ["4F1"], "Shure": ["4F4"] }
}
\`\`\`

### \u8F93\u51FA
\`\`\`json
{
  "decisions": [
    { "prodId": "ZMO00001", "priority": 1, "preferredLines": ["4F2"], "headcountMultiplier": 2.0, "allowOvertime": true,  "skip": false },
    { "prodId": "ZMO00002", "priority": 2, "preferredLines": ["4F1"], "headcountMultiplier": 1.0, "allowOvertime": false, "skip": false },
    { "prodId": "ZMO00003", "priority": 3, "preferredLines": ["4F4"], "headcountMultiplier": 1.0, "allowOvertime": false, "skip": false }
  ],
  "reasoning": "ZMO00001 \u5DF2\u903E\u671F23\u5929\u4E14\u4E3AChicha\u7EBF\u7269\u6599\u5F3A\u5236\u8D704F2\uFF0C\u4F18\u5148\u7EA7\u6700\u9AD8\u5E76\u5EFA\u8BAE\u53CC\u500D\u4EBA\u624B\u52A0\u73ED\uFF1B\u5176\u4F59\u8BA2\u5355\u6309\u5BA2\u6237\u5206\u7EC4\u6B63\u5E38\u6392\u4EA7\u3002"
}
\`\`\`
`.trim();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SKILL_MD
});
