'use strict';

/** A small catalogue for the manufacturer org, so a batch can be created immediately. */
const medicines = [
  { name: 'Amoxil', generic_name: 'Amoxicillin', strength: '500 mg', form: 'capsule', pack_size: '10 capsules' },
  { name: 'Paracit', generic_name: 'Paracetamol', strength: '650 mg', form: 'tablet', pack_size: '15 tablets' },
  { name: 'Cardiplex', generic_name: 'Atorvastatin', strength: '20 mg', form: 'tablet', pack_size: '30 tablets' },
  { name: 'Respiflow', generic_name: 'Salbutamol', strength: '100 mcg', form: 'inhaler', pack_size: '200 doses' },
  { name: 'Glucostat', generic_name: 'Metformin', strength: '850 mg', form: 'tablet', pack_size: '20 tablets' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const [manufacturer] = await queryInterface.sequelize.query(
      "SELECT id FROM organizations WHERE license_no = 'MFG-MH-100241'",
      { type: Sequelize.QueryTypes.SELECT }
    );
    if (!manufacturer) throw new Error('Organization seeder must run before the medicine seeder');

    await queryInterface.bulkInsert(
      'medicines',
      medicines.map((m) => ({
        ...m,
        manufacturer_id: manufacturer.id,
        is_active: true,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('medicines', {
      name: { [Sequelize.Op.in]: medicines.map((m) => m.name) },
    });
  },
};
