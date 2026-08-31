'use strict';

const tokenService = require('../services/token.service');
const ApiError = require('../utils/ApiError');
const { User, Organization } = require('../models');

/**
 * Verifies the bearer token and loads the user. The database round-trip is
 * deliberate: a token issued before an account was deactivated must stop
 * working immediately rather than at expiry.
 */
async function requireAuth(req, _res, next) {
  try {
    const token = tokenService.fromHeader(req.get('authorization'));
    if (!token) throw ApiError.unauthorized('Provide a bearer token in the Authorization header');

    const payload = tokenService.verify(token);

    const user = await User.findByPk(payload.sub, {
      include: [{ model: Organization, as: 'organization' }],
    });

    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
    if (!user.organization?.isActive) {
      throw ApiError.forbidden('Your organization has been deactivated');
    }

    req.user = user;
    req.auth = payload;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Restricts a route to one or more roles. Use after requireAuth. */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `This action is restricted to: ${allowed.join(', ')}. Your role is ${req.user.role}.`
        )
      );
    }
    return next();
  };
}

/**
 * The rule that makes RBAC mean "which distributor" rather than "a distributor".
 * Regulators are the deliberate exception — oversight is their entire purpose.
 */
function scopeToOrganization(req) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.role === 'regulator' ? {} : { organizationId: req.user.organizationId };
}

/** Guards a specific record: same organization, or regulator. */
function assertCanAccessOrganization(req, organizationId) {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === 'regulator') return;
  if (Number(req.user.organizationId) !== Number(organizationId)) {
    throw ApiError.forbidden('That record belongs to another organization');
  }
}

module.exports = { requireAuth, requireRole, scopeToOrganization, assertCanAccessOrganization };
