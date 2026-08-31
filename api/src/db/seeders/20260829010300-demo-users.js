'use strict';

const bcrypt = require('bcryptjs');

/**
 * One account per organization from the previous seeder, so every role can be
 * demonstrated without registering by hand. Shared demo password.
 *
 * Seeders use bulkInsert, which bypasses the model's hashing hook, so the hash
 * is computed here explicitly.
 */
const DEMO_PASSWORD = 'MedTrace#2026';

const users = [
  { email: 'maker@meridian.example', fullName: 'Asha Rao', role: 'manufacturer', license: 'MFG-MH-100241' },
  { email: 'ops@northgate.example', fullName: 'Vikram Shetty', role: 'distributor', license: 'DST-DL-330817' },
  { email: 'ops@coastal.example', fullName: 'Neha Iyer', role: 'distributor', license: 'DST-KA-551903' },
  { email: 'desk@lotus.example', fullName: 'Farhan Qureshi', role: 'pharmacy', license: 'PHM-DL-772140' },
  { email: 'desk@greenleaf.example', fullName: 'Meera Nair', role: 'pharmacy', license: 'PHM-KA-889302' },
  { email: 'inspector@cdsco.example', fullName: 'Dr. Sunil Menon', role: 'regulator', license: 'REG-IN-000001' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const organizations = await queryInterface.sequelize.query(
      'SELECT id, license_no FROM organizations',
      { type: Sequelize.QueryTypes.SELECT }
    );

    const orgIdByLicense = new Map(organizations.map((o) => [o.license_no, o.id]));

    const rows = users
      .filter((u) => orgIdByLicense.has(u.license))
      .map((u) => ({
        organization_id: orgIdByLicense.get(u.license),
        full_name: u.fullName,
        email: u.email,
        password_hash: passwordHash,
        role: u.role,
        is_active: true,
        created_at: now,
        updated_at: now,
      }));

    if (rows.length !== users.length) {
      throw new Error('Organization seeder must run before the user seeder');
    }

    await queryInterface.bulkInsert('users', rows);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('users', {
      email: { [Sequelize.Op.in]: users.map((u) => u.email) },
    });
  },
};
