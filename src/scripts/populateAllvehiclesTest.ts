import { poolPromise } from '../config/db';

async function generateVehicles(count: number) {
  const vehicles = [];

  for (let i = 0; i < count; i++) {
    const vehicle = {
      Data: JSON.stringify({
        VEHICLENUM: `${4333844 + i}`,
        VEHICLETYPECODE: Math.floor(Math.random() * 2) + 1,
        MNFCODE: ["005", "006", "007", "002", "014"][
          Math.floor(Math.random() * 5)
        ],
        COLORCODE: ["50", "51", "17", "52", "56", "77", "98"][
          Math.floor(Math.random() * 7)
        ],
        JRSDICTCODE: "ISR",
        YEARONROAD: `${2015 + Math.floor(Math.random() * 10)}`,
        WEIGHT: Math.floor(Math.random() * 2000) + 1000,
        STATDES: "פעיל",
        PLACES: Math.floor(Math.random() * 5),
        PLACENEXTDRIVER: 0,
      }),
    };

    vehicles.push(vehicle);
  }

  return vehicles;
}

async function populateTable() {
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }

  const vehicles = await generateVehicles(2000);

  try {
    for (const vehicle of vehicles) {
      await pool.request().input("Data", vehicle.Data).query(`
          INSERT INTO AllvehiclesTest (Data)
          VALUES (@Data)
        `);
    }

    console.log(`Inserted ${vehicles.length} records into AllvehiclesTest`);
  } catch (err) {
    console.error("Error populating table:", err);
    // Ensure IDENTITY_INSERT is turned off in case of error
  } finally {
    await pool.close();
  }
}

populateTable().catch(err => {
  console.error('Error populating table:', err);
});