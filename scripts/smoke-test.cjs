'use strict';
/*
 * ObsidianWork · demo-vault 冒烟测试（CI 用）
 * 用仓内自带的虚构演示库跑一遍索引器，断言关键解析结果。
 * 跑法：node scripts/smoke-test.mjs
 */
const path = require('path');
const { Vault } = require('../lib/vault');

const demoVault = path.join(__dirname, '..', 'demo-vault');
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}：${JSON.stringify(actual)}${ok ? '' : `（期望 ${JSON.stringify(expected)}）`}`);
  if (!ok) failed++;
}

const vault = new Vault(demoVault, { indexFile: '客户档案索引.md', clientsDir: 'Clients' });
vault.scanAll();

check('库健康', vault.healthy, true);
check('笔记总数', vault.notes.size, 14);

const c = vault.counts();
check('客户总数', c.total, 4);
check('待办客户', c.todo, 1);
check('火线客户', c.hot, 1);
check('挂起客户', c.paused, 1);

check('决策：总数', vault.decisions.total, 3);
check('决策：开启', vault.decisions.openCount, 2);
check('决策：新增', vault.decisions.freshCount, 1);
check('决策：历史裁决', vault.decisions.history.length, 2);

const caps = vault.captures();
check('便签：待办未完成', caps.counts.todoPending, 3);
check('便签：待办已完成', caps.counts.todoDone, 1);
check('便签：火花', caps.counts.spark, 2);

check('断链数', vault.brokenLinks().length, 0);
check('搜索「Cr-V」命中数', vault.search('Cr-V').length, 2);
check('知识树分区数', vault.knowledgeTree().sections.length, 5);

if (failed) {
  console.error(`\n✗ 冒烟测试失败：${failed} 项不符`);
  process.exit(1);
}
console.log('\n✓ demo-vault 冒烟测试全部通过');
