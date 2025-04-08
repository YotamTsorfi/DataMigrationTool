import { poolPromise } from '../config/db';

async function generateCustomers(count: number) {
  console.log(`Starting to generate ${count} customer records...`);
  const customers = [];

  for (let i = 0; i < count; i++) {
    const customer = {
      Data: JSON.stringify({
        CUSTDES: `לקוח API_GCC ${i + 1}`,
        STATDES: "פעיל",
        OWNERLOGIN: "tabula",
        CTYPECODE: "4",
        PHONE: "0503322321",
        EMAIL: "papa131@gmail.com",
        PAYCODE: "01",
        WTAXNUM: `78882${i + 1}`,
        STATUSDATE: "2024-04-18T00:00:00+02:00",
      }),
    };

    customers.push(customer);

    if (i > 0 && i % 200 === 0) {
      console.log(
        `Generated ${i} of ${count} customer records (${Math.floor((i / count) * 100)}%)...`
      );
    }
  }

  console.log(
    `Customer generation complete. Total: ${customers.length} records.`
  );
  return customers;
}

async function populateTable() {
  console.log("Connecting to database...");
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }
  console.log("Database connection established.");

  console.log("Generating customer data...");
  const customers = await generateCustomers(3000); // Adjust the number of customers as needed

  console.log("Beginning database insertion...");
  try {
    let insertedCount = 0;
    for (const customer of customers) {
      await pool.request().input("Data", customer.Data).query(`
          INSERT INTO AllCustomersTest (Data)
          VALUES (@Data)
        `);

      insertedCount++;
      // Log progress every 100 insertions
      if (insertedCount % 100 === 0) {
        console.log(
          `Progress: ${insertedCount} of ${customers.length} records inserted (${Math.floor((insertedCount / customers.length) * 100)}%)...`
        );
      }
    }

    console.log(
      `Insertion complete. Inserted ${customers.length} records into AllCustomersTest`
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

console.log("Starting customer database population script...");
populateTable()
  .catch((err) => {
    console.error("Error populating table:", err);
  })
  .finally(() => {
    console.log("Script execution completed.");
  });