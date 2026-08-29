'use strict';

/**
 * A minimal but geographically spread supply chain. The distances between
 * these cities are what make the travel-speed anomaly rules demonstrable
 * later, so keep them far apart.
 */
const now = new Date();

const organizations = [
  {
    name: 'Meridian Pharmaceuticals Ltd.',
    type: 'manufacturer',
    license_no: 'MFG-MH-100241',
    city: 'Mumbai',
    country: 'IN',
    latitude: 19.076,
    longitude: 72.8777,
  },
  {
    name: 'Northgate Medical Distribution',
    type: 'distributor',
    license_no: 'DST-DL-330817',
    city: 'Delhi',
    country: 'IN',
    latitude: 28.6139,
    longitude: 77.209,
  },
  {
    name: 'Coastal Health Logistics',
    type: 'distributor',
    license_no: 'DST-KA-551903',
    city: 'Bengaluru',
    country: 'IN',
    latitude: 12.9716,
    longitude: 77.5946,
  },
  {
    name: 'Lotus Pharmacy',
    type: 'pharmacy',
    license_no: 'PHM-DL-772140',
    city: 'Delhi',
    country: 'IN',
    latitude: 28.5355,
    longitude: 77.391,
  },
  {
    name: 'Greenleaf Chemists',
    type: 'pharmacy',
    license_no: 'PHM-KA-889302',
    city: 'Bengaluru',
    country: 'IN',
    latitude: 12.9352,
    longitude: 77.6245,
  },
  {
    name: 'Central Drugs Standard Control Organisation',
    type: 'regulator',
    license_no: 'REG-IN-000001',
    city: 'New Delhi',
    country: 'IN',
    latitude: 28.6129,
    longitude: 77.2295,
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert(
      'organizations',
      organizations.map((org) => ({
        ...org,
        is_active: true,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('organizations', {
      license_no: { [Sequelize.Op.in]: organizations.map((o) => o.license_no) },
    });
  },
};
