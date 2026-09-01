'use strict';

const serialService = require('../../services/serial.service');

/**
 * A supply chain with a past.
 *
 * Everything the other seeders create is born the moment `db:seed` runs, and
 * that quietly breaks the demo: the anomaly rules compare *implied speed*
 * between consecutive events, so a pack manufactured in Mumbai ninety seconds
 * ago and scanned by anyone outside Mumbai looks cloned. Every scan comes back
 * "suspect" and the one verdict worth showing — a clean, genuine pack with a
 * believable history — never appears.
 *
 * So this seeder backdates. Packs are manufactured six weeks ago, move through
 * a distributor, sit on a pharmacy shelf for a week, and a few are dispensed.
 * The result is a database that behaves like one that has been running, which
 * is what both the dashboards and the demo need.
 *
 * It writes rows directly rather than calling the services, because the whole
 * point is to control `created_at` — a service that stamps "now" on every
 * event cannot produce a history.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 60 * 60 * 1000);

/** Enough packs to look real, few enough to page through by hand. */
const HEALTHY_BATCH = { batchNo: 'MRD-2026-0417', medicine: 'Cardiplex', quantity: 24 };
const RECALLED_BATCH = { batchNo: 'MRD-2026-0392', medicine: 'Amoxil', quantity: 12 };

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const { QueryTypes } = Sequelize;

    // One transaction for the whole seeder, for the same reason batch creation
    // uses one: this writes to six tables in dependency order, and a failure
    // halfway leaves rows that no `down` will ever clean up, because a seeder
    // that threw is never recorded as having run. The orphans then block every
    // later revert with a foreign-key error.
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql) =>
        queryInterface.sequelize.query(sql, { type: QueryTypes.SELECT, transaction });

      const orgs = await query('SELECT id, name, type, latitude, longitude FROM organizations');
      const byType = (type) => orgs.filter((o) => o.type === type);

      const maker = byType('manufacturer')[0];
      const distributor = orgs.find((o) => o.name.startsWith('Northgate'));
      const pharmacy = orgs.find((o) => o.name.startsWith('Lotus'));
      if (!maker || !distributor || !pharmacy) {
        throw new Error('Organization seeder must run before the supply-chain seeder');
      }

      const [user] = await query(
        `SELECT id FROM users WHERE organization_id = ${maker.id} LIMIT 1`
      );

      const medicines = await query('SELECT id, name FROM medicines');
      const medicineId = (name) => medicines.find((m) => m.name === name)?.id;
      if (!medicineId(HEALTHY_BATCH.medicine)) {
        throw new Error('Medicine seeder must run before the supply-chain seeder');
      }

      // ------------------------------------------------------------- batches
      const batchRows = [HEALTHY_BATCH, RECALLED_BATCH].map((batch, index) => ({
        medicine_id: medicineId(batch.medicine),
        manufacturer_id: maker.id,
        batch_no: batch.batchNo,
        batch_code: serialService.generateBatchCode(),
        manufactured_on: isoDate(ago(index === 0 ? 42 : 70)),
        expires_on: isoDate(new Date(Date.now() + (index === 0 ? 700 : 400) * DAY)),
        quantity: batch.quantity,
        status: index === 0 ? 'active' : 'recalled',
        recalled_at: index === 0 ? null : ago(3),
        recall_reason: index === 0 ? null : 'Dissolution test failure in a retained sample',
        created_at: ago(index === 0 ? 42 : 70),
        updated_at: index === 0 ? ago(42) : ago(3),
      }));

      await queryInterface.bulkInsert('batches', batchRows, { transaction });

      const batches = await query(
        `SELECT id, batch_code, batch_no, quantity FROM batches WHERE batch_no IN ('${HEALTHY_BATCH.batchNo}', '${RECALLED_BATCH.batchNo}')`
      );
      const healthy = batches.find((b) => b.batch_no === HEALTHY_BATCH.batchNo);
      const recalled = batches.find((b) => b.batch_no === RECALLED_BATCH.batchNo);

      // --------------------------------------------------------------- packs
      //
      // The healthy batch is split so that every dashboard has something to
      // show and every verdict is reachable from seed data alone: most packs
      // reached the pharmacy, a few are still in the distributor's warehouse,
      // a few never left the factory, and two are already in a patient's hands.
      const packRows = [];
      const plan = [];

      const healthySerials = serialService.generateSerials(healthy.batch_code, healthy.quantity);
      healthySerials.forEach((serial, index) => {
        const stage = index < 16 ? 'pharmacy' : index < 20 ? 'distributor' : 'maker';
        const dispensed = index < 2;

        plan.push({ serial, stage, dispensed, batchId: healthy.id });
        packRows.push({
          batch_id: healthy.id,
          serial,
          current_organization_id:
            stage === 'pharmacy' ? pharmacy.id : stage === 'distributor' ? distributor.id : maker.id,
          state: dispensed ? 'dispensed' : stage === 'maker' ? 'created' : 'received',
          dispensed_at: dispensed ? ago(2) : null,
          scan_count: 0,
          last_scanned_at: null,
          created_at: ago(42),
          updated_at: ago(2),
        });
      });

      const recalledSerials = serialService.generateSerials(recalled.batch_code, recalled.quantity);
      recalledSerials.forEach((serial) => {
        plan.push({ serial, stage: 'pharmacy', dispensed: false, batchId: recalled.id });
        packRows.push({
          batch_id: recalled.id,
          serial,
          current_organization_id: pharmacy.id,
          state: 'received',
          dispensed_at: null,
          scan_count: 0,
          last_scanned_at: null,
          created_at: ago(70),
          updated_at: ago(3),
        });
      });

      await queryInterface.bulkInsert('packs', packRows, { transaction });

      const packs = await query(
        `SELECT id, serial FROM packs WHERE batch_id IN (${healthy.id}, ${recalled.id})`
      );
      const packId = new Map(packs.map((p) => [p.serial, p.id]));

      // ----------------------------------------------------------- shipments
      const shipmentRows = [
        {
          reference: 'SHP-DEMO-MFG-DST',
          from_organization_id: maker.id,
          to_organization_id: distributor.id,
          status: 'received',
          dispatched_at: ago(40),
          received_at: ago(38),
          created_at: ago(40),
          updated_at: ago(38),
        },
        {
          reference: 'SHP-DEMO-DST-PHR',
          from_organization_id: distributor.id,
          to_organization_id: pharmacy.id,
          status: 'received',
          dispatched_at: ago(9),
          received_at: ago(7),
          created_at: ago(9),
          updated_at: ago(7),
        },
      ];
      await queryInterface.bulkInsert('shipments', shipmentRows, { transaction });

      const shipments = await query(
        "SELECT id, reference FROM shipments WHERE reference LIKE 'SHP-DEMO-%'"
      );
      const shipmentId = (reference) => shipments.find((s) => s.reference === reference)?.id;

      const toDistributor = shipmentId('SHP-DEMO-MFG-DST');
      const toPharmacy = shipmentId('SHP-DEMO-PHR') || shipmentId('SHP-DEMO-DST-PHR');

      const moved = plan.filter((p) => p.stage !== 'maker');
      const reachedPharmacy = plan.filter((p) => p.stage === 'pharmacy');

      await queryInterface.bulkInsert('shipment_items', [
        // shipment_items carries no updated_at: a pack either travelled in a
        // shipment or it did not, and that never changes.
        ...moved.map((p) => ({
          shipment_id: toDistributor,
          pack_id: packId.get(p.serial),
          created_at: ago(40),
        })),
        ...reachedPharmacy.map((p) => ({
          shipment_id: toPharmacy,
          pack_id: packId.get(p.serial),
          created_at: ago(9),
        })),
      ], { transaction });

      // --------------------------------------------------------- scan events
      //
      // The order and the spacing are the whole point. Consecutive events are
      // days apart, so implied travel speed between Mumbai and Delhi is a few
      // km/h — exactly what an honest supply chain looks like, and the baseline
      // the detector needs in order for a cloned pack to stand out.
      const at = (org, when, type, shipment = null) => ({
        type,
        organization_id: org.id,
        user_id: user?.id ?? null,
        shipment_id: shipment,
        latitude: org.latitude,
        longitude: org.longitude,
        ip_address: null,
        user_agent: null,
        metadata: null,
        created_at: when,
      });

      const events = [];
      for (const p of plan) {
        const id = packId.get(p.serial);
        const born = p.batchId === healthy.id ? ago(42) : ago(70);
        events.push({ pack_id: id, ...at(maker, born, 'created') });

        if (p.stage === 'maker') continue;

        events.push({ pack_id: id, ...at(maker, ago(40), 'dispatched', toDistributor) });
        events.push({ pack_id: id, ...at(distributor, ago(38), 'received', toDistributor) });

        if (p.stage !== 'pharmacy') continue;

        events.push({ pack_id: id, ...at(distributor, ago(9), 'dispatched', toPharmacy) });
        events.push({ pack_id: id, ...at(pharmacy, ago(7), 'received', toPharmacy) });

        if (p.dispensed) events.push({ pack_id: id, ...at(pharmacy, ago(2), 'dispensed') });
      }

      await queryInterface.bulkInsert('scan_events', events, { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    const { QueryTypes } = Sequelize;
    const batches = await queryInterface.sequelize.query(
      `SELECT id FROM batches WHERE batch_no IN ('${HEALTHY_BATCH.batchNo}', '${RECALLED_BATCH.batchNo}')`,
      { type: QueryTypes.SELECT }
    );
    if (!batches.length) return;

    const ids = batches.map((b) => b.id);
    const packs = await queryInterface.sequelize.query(
      `SELECT id FROM packs WHERE batch_id IN (${ids.join(',')})`,
      { type: QueryTypes.SELECT }
    );
    const packIds = packs.map((p) => p.id);

    if (packIds.length) {
      await queryInterface.bulkDelete('scan_events', { pack_id: packIds });
      await queryInterface.bulkDelete('shipment_items', { pack_id: packIds });
    }
    await queryInterface.bulkDelete('shipments', {
      reference: { [Sequelize.Op.like]: 'SHP-DEMO-%' },
    });
    await queryInterface.bulkDelete('packs', { batch_id: ids });
    await queryInterface.bulkDelete('batches', { id: ids });
  },
};
