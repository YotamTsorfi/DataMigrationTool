import sql from 'mssql';
import { config } from './config';

// const dbConfig = {
//   user: config.db.user,
//   password: config.db.password,
//   server: config.db.server,
//   port: config.db.port,
//   database: config.db.database,
//   options: {
//     encrypt: true,
//     enableArithAbort: true,
//   },
// };

export const poolPromise = new sql.ConnectionPool(config.db)
  .connect()
  .then(pool => {
    console.log('Connected to MSSQL');
    return pool;
  })
  .catch(err => {
    console.error('Database Connection Failed! Bad Config: ', err);
    return null;
  });
