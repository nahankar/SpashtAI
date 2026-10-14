'use strict';

/**
 * AI Analytics Explorer access rules.
 *
 * Groups come from the JWT (`groups` or `group`) via contextToGroups.
 * `admin` can see identity and small demographic cells.
 * `ai` cannot see identity. Demographic aggregates with fewer than
 * MIN_COHORT learners are omitted. MIN_COHORT matches
 * apps/server/src/analytics/productEvents.ts.
 */

const MIN_COHORT = 5;

const ALLOWED_GROUPS = new Set(['ai', 'admin']);

const DEMOGRAPHIC_LEAVES = new Set(['gender', 'age', 'age_band', 'city', 'state']);

const ROW_ID_LEAVES = new Set(['id', 'user_id']);

const ELEVATE_CUBES = new Set(['elevate_language', 'elevate_nlp']);

const REPLAY_CUBES = new Set(['replay_language', 'replay_nlp']);

function normalizeGroups(securityContext = {}) {
  const raw = securityContext.groups ?? securityContext.group ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.filter((group) => ALLOWED_GROUPS.has(group)))];
}

function memberCube(member) {
  const value = String(member || '');
  const dot = value.indexOf('.');
  return dot === -1 ? value : value.slice(0, dot);
}

function memberLeaf(member) {
  const value = String(member || '');
  const dot = value.lastIndexOf('.');
  return dot === -1 ? value : value.slice(dot + 1);
}

function walkFilters(filters, visit) {
  for (const filter of filters || []) {
    if (!filter || typeof filter !== 'object') continue;
    if (Array.isArray(filter.and)) walkFilters(filter.and, visit);
    else if (Array.isArray(filter.or)) walkFilters(filter.or, visit);
    else visit(filter);
  }
}

function queryMembers(query) {
  const members = [];
  for (const dimension of query.dimensions || []) members.push(dimension);
  for (const measure of query.measures || []) members.push(measure);
  for (const segment of query.segments || []) members.push(segment);
  for (const timeDimension of query.timeDimensions || []) {
    if (timeDimension && timeDimension.dimension) members.push(timeDimension.dimension);
  }
  walkFilters(query.filters, (filter) => {
    if (filter.member) members.push(filter.member);
    if (filter.dimension) members.push(filter.dimension);
  });
  return members;
}

function usesLanguageMeasure(query) {
  return (query.measures || []).some((member) => {
    const leaf = memberLeaf(member);
    return leaf === 'sessions' || leaf === 'learner_count' || leaf.startsWith('median_');
  });
}

function suppressionMember(query) {
  if (usesLanguageMeasure(query)) {
    const measure = (query.measures || []).find((member) => {
      const leaf = memberLeaf(member);
      return leaf === 'sessions' || leaf === 'learner_count' || leaf.startsWith('median_');
    });
    return `${memberCube(measure)}.learner_count`;
  }
  const anchor = (query.dimensions && query.dimensions[0])
    || (query.measures && query.measures[0])
    || 'learners.count';
  return `${memberCube(anchor)}.count`;
}

function hasSufficientFloor(filters, member) {
  let found = false;
  walkFilters(filters, (filter) => {
    if (filter.member !== member || filter.operator !== 'gte') return;
    const raw = Array.isArray(filter.values) ? filter.values[0] : undefined;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= MIN_COHORT) found = true;
  });
  return found;
}

function assertSingleLanguageFact(members) {
  const cubes = new Set(members.map(memberCube));
  const elevate = [...cubes].some((cube) => ELEVATE_CUBES.has(cube));
  const replay = [...cubes].some((cube) => REPLAY_CUBES.has(cube));
  if (elevate && replay) {
    throw Object.assign(
      new Error('Query Elevate and Replay language metrics separately. One query cannot join both facts.'),
      { status: 400 },
    );
  }
}

function contextToGroups({ securityContext } = {}) {
  return normalizeGroups(securityContext);
}

function queryRewrite(query, { securityContext } = {}) {
  const groups = normalizeGroups(securityContext);
  const members = queryMembers(query);
  assertSingleLanguageFact(members);
  if (groups.includes('admin')) return query;

  const demographic = members.some((member) => DEMOGRAPHIC_LEAVES.has(memberLeaf(member)));
  if (!demographic) return query;

  if (query.ungrouped) {
    throw Object.assign(
      new Error('AI demographic queries must be aggregated.'),
      { status: 400 },
    );
  }
  if (members.some((member) => ROW_ID_LEAVES.has(memberLeaf(member)))) {
    throw Object.assign(
      new Error('AI queries cannot combine learner ids with demographic members. Page by id, or aggregate demographics without ids.'),
      { status: 400 },
    );
  }

  const member = suppressionMember(query);
  if (hasSufficientFloor(query.filters, member)) return query;
  return {
    ...query,
    filters: [
      ...(query.filters || []),
      { member, operator: 'gte', values: [String(MIN_COHORT)] },
    ],
  };
}

module.exports = {
  MIN_COHORT,
  normalizeGroups,
  contextToGroups,
  queryRewrite,
};
