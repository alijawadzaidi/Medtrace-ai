'use strict';

const { User, Organization } = require('../models');
const tokenService = require('../services/token.service');
const ApiError = require('../utils/ApiError');

/**
 * A user's role must match the type of organization they claim to belong to.
 * A "manufacturer" account attached to a pharmacy is a data-integrity hole
 * that every downstream permission check would then inherit.
 */
async function register(req, res) {
  const { fullName, email, password, role, organizationId } = req.body;

  const organization = await Organization.findByPk(organizationId);
  if (!organization) throw ApiError.badRequest('No organization with that id exists');
  if (!organization.isActive) throw ApiError.badRequest('That organization is not active');

  if (organization.type !== role) {
    throw ApiError.badRequest(
      `Role "${role}" does not match the organization type "${organization.type}"`
    );
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const user = await User.create({
    fullName,
    email,
    passwordHash: password, // hashed by the model's beforeCreate hook
    role,
    organizationId,
  });

  const created = await User.findByPk(user.id, {
    include: [{ model: Organization, as: 'organization' }],
  });

  res.status(201).json({
    user: created,
    token: tokenService.sign(created),
  });
}

async function login(req, res) {
  const { email, password } = req.body;

  const user = await User.scope('withPassword').findOne({
    where: { email },
    include: [{ model: Organization, as: 'organization' }],
  });

  // One message for both "no such user" and "wrong password", so the endpoint
  // cannot be used to discover which email addresses are registered.
  const invalid = ApiError.unauthorized('Email or password is incorrect');
  if (!user) throw invalid;

  const ok = await user.verifyPassword(password);
  if (!ok) throw invalid;

  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
  if (!user.organization?.isActive) throw ApiError.forbidden('Your organization has been deactivated');

  await user.update({ lastLoginAt: new Date() });

  res.json({
    user: user.toJSON(),
    token: tokenService.sign(user),
  });
}

async function me(req, res) {
  res.json({ user: req.user });
}

/**
 * A user may edit only their own profile. There is no path here to change
 * role or organization — those are structural and would need a regulator
 * workflow, not a self-service field.
 */
async function updateMe(req, res) {
  const { fullName, password } = req.body;

  const user = await User.scope('withPassword').findByPk(req.user.id);
  if (fullName !== undefined) user.fullName = fullName;
  if (password !== undefined) user.passwordHash = password; // hashed by beforeUpdate
  await user.save();

  const fresh = await User.findByPk(user.id, {
    include: [{ model: Organization, as: 'organization' }],
  });

  res.json({ user: fresh });
}

module.exports = { register, login, me, updateMe };
