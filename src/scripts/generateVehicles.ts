// generateVehicles.ts
import fs from 'fs';
import path from 'path';

function generateVehicles(count: number) {
  const vehicles = [];

  for (let i = 0; i < count; i++) {
    const vehicle = {
      VEHICLENUM: `${42212344 + i}`, // מספר רכב ייחודי
      VEHICLETYPECODE: Math.floor(Math.random() * 2) + 1, // 1-2
      MNFCODE: ["005", "006", "007", "002", "014"][
        Math.floor(Math.random() * 5)
      ],
      MODELCODE: null,
      MODELDES: null,
      COLORCODE: ["50", "51", "17", "52", "56", "77", "98"][
        Math.floor(Math.random() * 7)
      ],
      JRSDICTCODE: "ISR",
      YEARONROAD: `${2015 + Math.floor(Math.random() * 10)}`, // שנים 2015-2024
      WEIGHT: Math.floor(Math.random() * 2000) + 1000, // משקל בין 1000-3000
      STATDES: ["פעיל", "פעיל", "פעיל"][Math.floor(Math.random() * 3)],
      OWNSTARTDATE: null,
      PHONE: null,
      UNKNOWN: null,
      UNKNOWNDATE: null,
      LICENSE_DATE: null,
      PLACES: Math.floor(Math.random() * 5), // 0-4 מקומות
      PLACENEXTDRIVER: 0,
      FBCN_VALIDDATEUPDATE: null,
      NATG_CREDITCODE: null,
      NATG_CREDITDES: null,
      CRYR_VECCLASSCODE: null,
      CRYR_VECCLASSDES: null,
      CRYR_EUROPCLASS: null,
      CRYR_CLASSUDATE: null,
      CRYR_CHECKINDB: null,
      NATF_simulation: null,
    };

    vehicles.push(vehicle);
  }

  return vehicles;
}

// יצירת הקובץ
function createVehiclesFile() {
  const vehicles = generateVehicles(100);

  // נתיב לשמירת הקובץ (שים לב לנתיב המדויק בפרויקט שלך)
  const filePath = path.join(__dirname, "../data/vehicles.json");

  // וודא שתיקיית data קיימת
  const dataDir = path.join(__dirname, "../data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // כתיבת הקובץ
  fs.writeFileSync(filePath, JSON.stringify(vehicles, null, 2), "utf-8");

  console.log(`Created ${vehicles.length} vehicles in ${filePath}`);
}

// הרצת הסקריפט
createVehiclesFile();