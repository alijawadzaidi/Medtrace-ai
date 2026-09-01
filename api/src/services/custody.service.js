'use strict';

const ApiError = require('../utils/ApiError');

/**
 * The chain of custody, expressed as a state machine.
 *
 * This is the cheapest and most effective anti-counterfeit control in the
 * system. Without it, a pack can appear at a pharmacy having never left the
 * manufacturer, and the record looks perfectly ordinary. With it, that
 * movement is rejected at the door and the attempt is logged.
 *
 * It is also what makes Phase 6 possible: fraud has to produce an *illegal*
 * or *implausible* trail to be detectable, and this defines "illegal".
 */
const TRANSITIONS = {
  created: ['in_transit'],
  in_transit: ['received'],
  received: ['in_transit', 'dispensed', 'destroyed'],
  dispensed: [], // terminal — a dispensed pack is with a patient
  destroyed: [], // terminal
};

/**
 * Which organization types may ship to which. A pharmacy shipping to a
 * manufacturer is not a workflow, it is a red flag.
 */
const ALLOWED_ROUTES = {
  manufacturer: ['distributor', 'pharmacy'],
  distributor: ['distributor', 'pharmacy'],
  pharmacy: [],
  regulator: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(pack, to) {
  if (!canTransition(pack.state, to)) {
    const allowed = TRANSITIONS[pack.state] || [];
    throw ApiError.conflict(
      allowed.length
        ? `Pack ${pack.serial} is "${pack.state}" and can only move to: ${allowed.join(', ')}`
        : `Pack ${pack.serial} is "${pack.state}", which is a final state`
    );
  }
}

function assertRouteAllowed(fromType, toType) {
  const allowed = ALLOWED_ROUTES[fromType] || [];
  if (!allowed.includes(toType)) {
    throw ApiError.badRequest(
      allowed.length
        ? `A ${fromType} may only ship to: ${allowed.join(', ')}. Not to a ${toType}.`
        : `A ${fromType} cannot dispatch shipments.`
    );
  }
}

/** Only whoever physically holds a pack may send it onward. */
function assertHolder(pack, organizationId) {
  if (Number(pack.currentOrganizationId) !== Number(organizationId)) {
    throw ApiError.forbidden(
      `Pack ${pack.serial} is not held by your organization, so you cannot dispatch it`
    );
  }
}

module.exports = {
  TRANSITIONS,
  ALLOWED_ROUTES,
  canTransition,
  assertTransition,
  assertRouteAllowed,
  assertHolder,
};
