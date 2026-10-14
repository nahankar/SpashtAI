'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MIN_COHORT, contextToGroups, queryRewrite } = require('./security');

test('contextToGroups keeps only ai and admin', () => {
  assert.deepEqual(contextToGroups({ securityContext: { groups: ['ai', 'stranger'] } }), ['ai']);
  assert.deepEqual(contextToGroups({ securityContext: { group: 'admin' } }), ['admin']);
  assert.deepEqual(contextToGroups({ securityContext: {} }), []);
});

test('ai demographic aggregates gain a learner-count floor', () => {
  const rewritten = queryRewrite({
    measures: ['learner_explorer.count'],
    dimensions: ['learner_explorer.age_band', 'learner_explorer.gender'],
  }, { securityContext: { groups: ['ai'] } });
  assert.deepEqual(rewritten.filters, [{
    member: 'learner_explorer.count',
    operator: 'gte',
    values: [String(MIN_COHORT)],
  }]);
});

test('ai language medians are suppressed on the language learner count', () => {
  const rewritten = queryRewrite({
    measures: ['elevate_nlp.median_wpm', 'elevate_nlp.median_filler_rate'],
    dimensions: ['elevate_nlp.state'],
    timeDimensions: [{ dimension: 'elevate_nlp.started_at', dateRange: 'Last 30 days' }],
  }, { securityContext: { groups: ['ai'] } });
  assert.equal(rewritten.filters[0].member, 'elevate_nlp.learner_count');
  assert.equal(rewritten.filters[0].values[0], '5');
});

test('ai can page ids without a suppression filter', () => {
  const query = {
    dimensions: ['learners.id', 'learners.used_prepare', 'learners.used_interviews'],
    order: { 'learners.id': 'asc' },
    limit: 50,
    offset: 0,
  };
  assert.deepEqual(queryRewrite(query, { securityContext: { groups: ['ai'] } }), query);
});

test('ai cannot combine ids with demographics or request ungrouped demographics', () => {
  assert.throws(() => queryRewrite({
    dimensions: ['learners.id', 'learners.city'],
  }, { securityContext: { groups: ['ai'] } }), /cannot combine learner ids/);
  assert.throws(() => queryRewrite({
    ungrouped: true,
    dimensions: ['learners.gender'],
  }, { securityContext: { groups: ['ai'] } }), /must be aggregated/);
});

test('admin queries are not suppressed', () => {
  const query = {
    dimensions: ['learners.id', 'learners.first_name', 'learners.email', 'learners.gender'],
    measures: ['learners.count'],
  };
  assert.deepEqual(queryRewrite(query, { securityContext: { groups: ['admin'] } }), query);
  assert.deepEqual(
    queryRewrite(query, { securityContext: { groups: ['ai', 'admin'] } }),
    query,
  );
});

test('a weaker count floor does not replace the privacy threshold', () => {
  const rewritten = queryRewrite({
    measures: ['learners.count'],
    dimensions: ['learners.gender'],
    filters: [{ member: 'learners.count', operator: 'gte', values: ['1'] }],
  }, { securityContext: { groups: ['ai'] } });
  assert.equal(rewritten.filters.at(-1).operator, 'gte');
  assert.equal(rewritten.filters.at(-1).values[0], '5');
});

test('an existing cohort filter is left in place', () => {
  const query = {
    measures: ['learners.count'],
    dimensions: ['learners.gender'],
    filters: [{ member: 'learners.count', operator: 'gte', values: ['5'] }],
  };
  assert.deepEqual(queryRewrite(query, { securityContext: { groups: ['ai'] } }), query);
});

test('Elevate and Replay language facts cannot be queried together', () => {
  assert.throws(() => queryRewrite({
    measures: ['elevate_language.median_wpm', 'replay_language.median_wpm'],
  }, { securityContext: { groups: ['admin'] } }), /separately/);
});
