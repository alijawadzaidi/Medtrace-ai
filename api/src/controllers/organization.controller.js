'use strict';

const { Op } = require('sequelize');

const { Organization } = require('../models');
const custody = require('../services/custody.service');
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

/**
 * Who this organization may legally ship to.
 *
 * Organization scoping says a distributor sees only itself — which is right
 * for records, and impossible for shipping: you cannot address a shipment to
 * an organization you are not allowed to know exists. So this is a directory,
 * deliberately narrow in two ways. It returns only the *types* the custody
 * rules permit as a destination, so a pharmacy (which may not dispatch at all)
 * gets an empty list; and it returns only what an address label needs — name,
 * type, city — never licence numbers, coordinates or counts of anything.
 */
async function listPartners(req, res) {
  const allowedTypes = custody.ALLOWED_ROUTES[req.user.organization.type] || [];

  const organizations = allowedTypes.length
    ? await Organization.findAll({
        where: {
          type: { [Op.in]: allowedTypes },
          isActive: true,
          id: { [Op.ne]: req.user.organizationId },
        },
        attributes: ['id', 'name', 'type', 'city'],
        order: [['name', 'ASC']],
      })
    : [];

  res.json({
    from: { type: req.user.organization.type, mayShipTo: allowedTypes },
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

module.exports = { list, listPartners, getById };
