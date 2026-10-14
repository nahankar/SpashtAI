'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const modelDir = path.join(__dirname, '../model');

function loadYaml(name) {
  const file = path.join(modelDir, name);
  const json = execFileSync(
    'ruby',
    ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', file],
    { encoding: 'utf8' },
  );
  return JSON.parse(json);
}

function aiIncludes(entity) {
  const policy = (entity.access_policy || []).find((item) => item.group === 'ai');
  assert.ok(policy, `${entity.name} is missing an ai policy`);
  return policy.member_level.includes;
}

test('learner, language, and view policies match the explorer contract', () => {
  const learners = loadYaml('learners.yml').cubes[0];
  const elevate = loadYaml('elevate_language.yml').cubes[0];
  const replay = loadYaml('replay_language.yml').cubes[0];
  const views = loadYaml('views.yml').views;
  const byName = Object.fromEntries(views.map((view) => [view.name, view]));

  for (const entity of [learners, elevate, replay, ...views]) {
    const groups = entity.access_policy.map((policy) => policy.group).sort();
    assert.deepEqual(groups, ['admin', 'ai']);
    const admin = entity.access_policy.find((policy) => policy.group === 'admin');
    assert.equal(admin.member_level.includes, '*');
    for (const forbidden of ['first_name', 'last_name', 'email', 'wpm_sample', 'filler_rate_sample']) {
      assert.equal(aiIncludes(entity).includes(forbidden), false, `${entity.name} exposes ${forbidden} to ai`);
    }
  }

  for (const flag of [
    'used_replay',
    'used_elevate',
    'used_interviews',
    'used_progress_pulse',
    'used_prepare',
    'used_feedback',
  ]) {
    assert.ok(aiIncludes(learners).includes(flag));
    assert.ok(aiIncludes(byName.learner_explorer).includes(flag));
    assert.ok(aiIncludes(byName.elevate_nlp).includes(flag));
    assert.ok(aiIncludes(byName.replay_nlp).includes(flag));
  }

  for (const demographic of ['gender', 'age', 'age_band', 'city', 'state']) {
    assert.ok(aiIncludes(learners).includes(demographic));
  }
  assert.ok(aiIncludes(learners).includes('id'));
  assert.ok(aiIncludes(learners).includes('count'));
  assert.equal(aiIncludes(elevate).includes('id'), false);
  assert.equal(aiIncludes(elevate).includes('user_id'), false);
  assert.equal(aiIncludes(replay).includes('id'), false);
  assert.equal(aiIncludes(replay).includes('user_id'), false);

  const medians = [
    'median_wpm',
    'median_filler_rate',
    'median_hedging_rate',
    'median_sentence_length',
    'median_vocab_diversity',
    'median_readability',
    'median_coherence',
  ];
  for (const median of medians) {
    assert.ok(aiIncludes(elevate).includes(median));
    assert.ok(aiIncludes(replay).includes(median));
    assert.ok(aiIncludes(byName.elevate_nlp).includes(median));
    assert.ok(aiIncludes(byName.replay_nlp).includes(median));
    assert.match(elevate.measures.find((measure) => measure.name === median).sql, /PERCENTILE_CONT\(0\.5\)/);
    assert.match(replay.measures.find((measure) => measure.name === median).sql, /PERCENTILE_CONT\(0\.5\)/);
  }

  const events = fs.readFileSync(
    path.join(__dirname, '../../../apps/server/src/analytics/productEvents.ts'),
    'utf8',
  );
  const actionBlock = events.slice(events.indexOf('FEATURE_USE_ACTIONS'), events.indexOf('const SERVER_ACTIONS'));
  for (const feature of ['replay', 'elevate', 'interviews', 'progress_pulse', 'prepare', 'feedback']) {
    const match = new RegExp(`${feature}: \\[([\\s\\S]*?)\\]`).exec(actionBlock);
    assert.ok(match, `missing feature use actions for ${feature}`);
    const actions = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
    assert.ok(actions.length > 0, feature);
    for (const action of actions) {
      assert.match(learners.sql, new RegExp(`'${action}'`));
    }
    assert.match(learners.sql, new RegExp(`fu.feature = '${feature}'[\\s\\S]*fu.action IN`));
  }
  assert.match(learners.sql, /module = 'elevate'/);
  assert.match(learners.sql, /CURRENT_TIMESTAMP/);
  assert.equal(learners.sql.includes('CURRENT_DATE'), false);
  assert.match(learners.sql, /s\."discardedAt" IS NULL/);

  assert.match(learners.sql, /role::text = 'USER'/);
  assert.match(learners.sql, /PreparationRecording/);
  assert.match(learners.sql, /PreparationPractice/);
  assert.match(learners.sql, /InterviewRun/);
  assert.match(learners.sql, /replay-server-assessment-v1/);
  assert.match(elevate.sql, /module = 'elevate'/);
  assert.match(elevate.sql, /PreparationPractice/);
  assert.match(elevate.sql, /InterviewRun/);
  assert.match(replay.sql, /PreparationRecording/);
  assert.match(replay.sql, /purpose::text = 'COMMUNICATION'/);
  assert.equal(learners.sql.includes('passwordHash'), false);
  assert.equal(learners.sql.includes('pincode'), false);
  assert.equal(elevate.sql.includes('transcript'), false);
  assert.equal(replay.sql.includes('transcriptText'), false);

  const hidden = [...elevate.dimensions, ...replay.dimensions].filter((dimension) => dimension.public === false);
  assert.equal(hidden.length, 14);
});

test('compose pins Cube 1.8.5, memory cache, and dev mode off', () => {
  const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');
  const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  assert.match(compose, /cubejs\/cube:v1\.8\.5/);
  assert.match(compose, /CUBEJS_DEV_MODE: "false"/);
  assert.match(compose, /CUBEJS_CACHE_AND_QUEUE_DRIVER: memory/);
  assert.equal(compose.includes('CUBEJS_PG_SQL_PORT'), false);
  assert.equal(example.includes('CUBEJS_PG_SQL_PORT='), false);
  assert.match(example, /DATABASE_URL=/);
  assert.match(example, /CUBEJS_DEV_MODE=false/);
});
