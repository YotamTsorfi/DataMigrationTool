import { DatabaseService } from "../services/databaseService";
import { ChildJob } from "../jobs/jobParentAndChilds";

//import { Readable, Transform } from 'stream'; // Might be needed in order to use streams in Node.js
interface ParentRecord {
  RowId: number;
  Data: string;
  [key: string]: any; 
}
interface ChildRecord {
  RowId: number;
  Data: string;
  [key: string]: any; 
}
//---------------------------------------------------------------------------
// תוצאת הפונקציה תהיה סטרים של אובייקטי JSON מוכנים לשליחה
/*
לעצור ולהמשיך את הריצה שלה - הפונקציה יכולה "להפסיק" באמצע הריצה ולהמשיך מאותה נקודה בפעם הבאה שהיא מתבקשת לרוץ
להחזיר ערכים מרובים לאורך זמן - באמצעות מילת המפתח yield
לייצר ערכים לפי דרישה (lazy evaluation) - במקום לייצר את כל הערכים בבת אחת
צריכת זיכרון מינימלית - במקום לטעון את כל מיליוני הרשומות לזיכרון, היא מעבדת ומחזירה אותן אחת אחת
יעילות תהליכית - מאפשרת לעבד כל רשומה מיד כשהיא זמינה
הימנעות מ-Out of Memory - חיוני כשעובדים עם מיליוני רשומות
*/
export async function* streamParentChildData(
    parentTableName: string,
    batchSize: number,
    startRow: number,
    maxRows: number,
    linkedField: string,
    childJobs: ChildJob[]
  ): AsyncGenerator<any> {
    let processedRows = 0;
    let currentOffset = startRow;
    
    while (processedRows < maxRows) {
        const currentBatchSize = Math.min(batchSize, maxRows - processedRows);
      
        // שליפת רשומות האב
        const parentRecords = await fetchEligibleParentRecords(
        parentTableName,
        currentOffset,
        currentBatchSize,
        linkedField
        );
      
        if (parentRecords.length === 0) {
            break; // אין עוד רשומות לעיבוד
        }
          
        // מיצוי ערכי המפתח לצורך שליפת ילדים
        const linkedValues = parentRecords.map(record => record[linkedField]);
        // console.log(`Extracted ${linkedValues.length} linked values from parent records`);
    
        // שליפת נתוני ילדים לכל סוגי הילדים
        const childDataMap = await fetchAllChildData(childJobs, linkedValues, linkedField);

        // עיבוד כל רשומת אב בנפרד ויצירת JSON מוכן
        for (const parent of parentRecords) {
            const linkValue = parent[linkedField];
            const parsedParentData = parseJsonData(parent.Data);            

            // שימוש ישיר באובייקט המקורי
            const priorityObject = parsedParentData;

            // Create a tracking structure to store child records by job type
            const childRecordsByType: Record<string, any[]> = {};      

            // הוספת הילדים הרלוונטיים לכל אב בהתאם להגדרת HasSiblings
            for (const job of childJobs) {
                 const childRecords = childDataMap.get(job.JobTypeName)?.get(linkValue) || [];

                  // Preserve both parsed data AND RowId for each child record
                  const parsedChildData = childRecords.map(child => {
                      const parsed = parseJsonData(child.Data);
                      return {
                          ...parsed,
                          RowId: child.RowId, // Add RowId for tracking
                          __tableName: job.DBTableName, // Add tableName for consistency
                          __jobTypeName: job.JobTypeName // Add job type name for better debugging
                      };
                  });

                // Store child records for tracking (by job type)
                childRecordsByType[job.JobTypeName] = parsedChildData;

                // שם המפתח נקבע לפי ScreenName + _SUBFORM
                const subformKey = `${job.ScreenName}_SUBFORM`;
                
                if (job.HasSiblings) {
                  // אם יש אפשרות לילדים מרובים, משתמשים במערך אבל מסירים את ה-RowId מכל רשומה
                  priorityObject[subformKey] = parsedChildData.map(item => {
                    const { RowId, __tableName, __jobTypeName, ...childWithoutMetadata } = item;
                    return childWithoutMetadata;
                  });
                } else {
                    // For single child case
                    if (parsedChildData.length === 0) {
                        priorityObject[subformKey] = {};
                    } else if (parsedChildData.length === 1) {
                        // Remove RowId from API payload but keep the rest
                        const { RowId, __tableName, __jobTypeName, ...childWithoutMetadata } = parsedChildData[0];
                        priorityObject[subformKey] = childWithoutMetadata;
                    } else {
                        console.warn(`Expected only one child record for ${job.ScreenName} but found ${parsedChildData.length}`);
                        const { RowId, __tableName, __jobTypeName, ...childWithoutMetadata } = parsedChildData[0];
                        priorityObject[subformKey] = childWithoutMetadata;
                    }
                }
            }    
            
            // Include the RowId in the object for tracking purposes
            const priorityObjectWithTracking = {
              ...priorityObject,
              RowId: parent.RowId, // Preserve RowId for error tracking
              childRecords: childRecordsByType  // Organized child records with RowIds
            };
            
            // Add console log to inspect if child RowIds are preserved
            // console.log('Priority object with tracking:', JSON.stringify(priorityObjectWithTracking, null, 2));
            // Yield the enriched object
            yield priorityObjectWithTracking;
            
            processedRows++;
        }        
          // התקדמות לחלק הבא
        currentOffset += parentRecords.length;      
    }
  }
//---------------------------------------------------------------------------
/**
 * Map-בניית מבנה היררכי של נתוני הילדים באמצעות מבני נתונים מסוג 
 */
async function fetchAllChildData(
    childJobs: ChildJob[],
    linkedValues: any[],
    linkedField: string 
  ): Promise<Map<string, Map<any, ChildRecord[]>>> {
    // console.log(`Fetching child data, Parent linked value: ${linkedValues}`);

    // מפה דו-רמתית: סוג הילד -> ערך מקשר -> רשימת רשומות
    const childDataMap = new Map<string, Map<any, ChildRecord[]>>();
    
    // שליפה מקבילה של כל סוגי הילדים
    await Promise.all(childJobs.map(async (childJob) => {
        // console.log(`Fetching children for job type: ${childJob.JobTypeName}, table: ${childJob.DBTableName}`);
        
        // תיקון: העברת linkedField במקום childJob.priority_id
        const childRecords = await fetchChildRecords(
          childJob.DBTableName,
          linkedField,  // משתמשים בשדה המקשר שהועבר מהאב
          linkedValues
        );

        // console.log(`Fetched ${childRecords.length} child records for ${childJob.JobTypeName}`);
      
        // יצירת מפה פנימית לסוג הילד הנוכחי
        const innerMap = new Map<any, ChildRecord[]>();
      
        // ארגון הרשומות לפי ערך המפתח - גם כאן משתמשים בlinkedField
        for (const record of childRecords) {
          const linkValue = record[linkedField];  // תיקון: משתמשים באותו שדה מקשר גם כאן
          if (!innerMap.has(linkValue)) {
            innerMap.set(linkValue, []);
          }
          innerMap.get(linkValue)!.push(record);
        }
      
        childDataMap.set(childJob.JobTypeName, innerMap);
    }));
    
    return childDataMap;
  }
//---------------------------------------------------------------------------
/**
 * שליפת רשומות אב העומדות בתנאים הנדרשים
 */
async function fetchEligibleParentRecords(
    tableName: string,
    offset: number,
    limit: number,
    linkedField: string
  ): Promise<ParentRecord[]> {
    try {
      // console.log(`Starting to fetch parent records from ${tableName}`);
      const query = `
        SELECT TOP (${limit}) RowId, Data, ${linkedField}
        FROM ${tableName}
        WHERE is_eligible = 1
        AND is_new = 1
        AND Status IS NULL
        AND RowId >= ${offset}
        ORDER BY RowId ASC
      `;
    
      // console.log(`Fetching parent records from ${tableName} with offset ${offset}, limit ${limit}`);
      const results = await DatabaseService.executeQuery(query);
      // console.log(`Finished fetching ${results?.length || 0} parent records`);
      return results as ParentRecord[];
    } catch (error) {
      console.error(`Error in fetchEligibleParentRecords: ${error}`);
      throw error;
    }
  }
//---------------------------------------------------------------------------
/**
 * שליפת רשומות ילדים על פי רשימת ערכי קישור
 * משתמש בשאילתה מותאמת כדי לטפל ביעילות במספר גדול של ערכים
 */
async function fetchChildRecords(
  tableName: string,
  linkFieldName: string,
  linkValues: any[]
): Promise<ChildRecord[]> {
  if (linkValues.length === 0) {
    return [];
  }

  // בדיקה האם מדובר במספר גדול של ערכים ושימוש בטבלה זמנית במידת הצורך
  if (linkValues.length > 2000) {
    return await fetchChildRecordsWithTempTable(tableName, linkFieldName, linkValues);
  }

  const placeholders = linkValues.map((_, i) => `@p${i}`).join(', ');
  const params: any = {};
  linkValues.forEach((val, i) => {
    params[`p${i}`] = val;
  });

  const query = `
    SELECT RowId, Data, ${linkFieldName}
    FROM ${tableName}
    WHERE ${linkFieldName} IN (${placeholders})
    AND is_eligible = 1
    AND is_new = 1
    AND Status IS NULL
    ORDER BY RowId ASC
  `;

  // console.log(`Fetching ${linkValues.length} child records from ${tableName}`);
  return await DatabaseService.executeQuery(query, params);
}
//---------------------------------------------------------------------------
/**
 * שליפת רשומות ילדים עם טבלה זמנית עבור מספר גדול של ערכי קישור
 */
async function fetchChildRecordsWithTempTable(
  tableName: string,
  linkFieldName: string,
  linkValues: any[]
): Promise<ChildRecord[]> {
  const tempTableName = `#Temp_LinkValues_${Date.now()}`;
  
  try {
    // יצירת טבלה זמנית
    await DatabaseService.executeQuery(`
      CREATE TABLE ${tempTableName} (LinkValue NVARCHAR(255))
    `);

    // הכנסת הערכים לטבלה הזמנית (בקבוצות)
    const batchSize = 1000;
    for (let i = 0; i < linkValues.length; i += batchSize) {
      const batch = linkValues.slice(i, i + batchSize);
      const valuePlaceholders = batch.map(() => '(?)').join(',');
      await DatabaseService.executeQuery(`
        INSERT INTO ${tempTableName} (LinkValue)
        VALUES ${valuePlaceholders}
      `, batch);
    }

    // שליפת הנתונים המקושרים באמצעות הטבלה הזמנית
    return await DatabaseService.executeQuery(`
      SELECT c.RowId, c.Data, c.${linkFieldName}
      FROM ${tableName} c
      INNER JOIN ${tempTableName} t ON c.${linkFieldName} = t.LinkValue
      WHERE c.is_eligible = 1
      ORDER BY c.RowId ASC
    `);
  } finally {
    // מחיקת הטבלה הזמנית
    await DatabaseService.executeQuery(`DROP TABLE IF EXISTS ${tempTableName}`);
  }
}
//---------------------------------------------------------------------------
/**
 * פענוח נתוני JSON בצורה בטוחה
 */
function parseJsonData(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn(`Failed to parse JSON data: ${error}`);
    return {};
  }
}