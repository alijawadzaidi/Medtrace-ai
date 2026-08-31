'use strict';

const { Organization } = require('../models');
const ApiError = require('../utils/ApiError');
const { assertCanAccessOrganization } = require('../middleware/auth');

/**
 * Demonstrates the scoping rule end to end: a regulator sees the whole supply
 * chain, everyone else sees only their own organization.
 */
async function list(req, res) {
  const where = req.user.role === 'regulator' ? {} : { id: req.user.organizationId };

  const organizations = await Organization.findAll({
    where,
    order: [['name', 'ASC']],
  });

  res.json({
    scope: req.user.role === 'regulator' ? 'all' : 'own-organization',
    count: organizations.length,
    organizations,
  });
}

async function getById(req, res) {
  assertCanAccessOrganization(req, req.params.id);

  const organization = await Organization.findByPk(req.params.id);
  if (!organization) throw ApiError.notFound('No organization with that id exists');

  res.json({ organization });
}

module.exports = { list, getById };
