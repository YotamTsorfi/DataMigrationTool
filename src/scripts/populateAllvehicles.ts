import { poolPromise } from '../config/db';

async function generateVehicles(count: number) {
  console.log(`Starting to generate ${count} vehicle records...`);
  const vehicles = [];

  for (let i = 0; i < count; i++) {
    const vehicle = {
      Data: JSON.stringify({
        VEHICLENUM: `${2221111 + i}`,
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

    // Log progress every 200 records
    if (i > 0 && i % 200 === 0) {
      console.log(
        `Generated ${i} of ${count} vehicle records (${Math.floor((i / count) * 100)}%)...`
      );
    }
  }

  console.log(
    `Vehicle generation complete. Total: ${vehicles.length} records.`
  );
  return vehicles;
}

async function populateTable() {
  console.log("Connecting to database...");
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }
  console.log("Database connection established.");

  console.log("Generating vehicle data...");
  const vehicles = await generateVehicles(100000);

  console.log("Beginning database insertion...");
  try {
    let insertedCount = 0;
    for (const vehicle of vehicles) {
      await pool.request().input("Data", vehicle.Data).query(`
          INSERT INTO AllvehiclesTest (Data)
          VALUES (@Data)
        `);

      insertedCount++;
      // Log progress every 100 insertions
      if (insertedCount % 100 === 0) {
        console.log(
          `Progress: ${insertedCount} of ${vehicles.length} records inserted (${Math.floor((insertedCount / vehicles.length) * 100)}%)...`
        );
      }
    }

    console.log(
      `Insertion complete. Inserted ${vehicles.length} records into AllvehiclesTest`
    );
  } catch (err) {
    console.error("Error populating table:", err);
    // Ensure IDENTITY_INSERT is turned off in case of error
  } finally {
    console.log("Closing database connection...");
    await pool.close();
    console.log("Database connection closed.");
  }
}

console.log("Starting vehicle database population script...");
populateTable()
  .catch((err) => {
    console.error("Error populating table:", err);
  })
  .finally(() => {
    console.log("Script execution completed.");
  });