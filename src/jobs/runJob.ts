import { processBatches } from './job';

processBatches().then(results => {
  console.log('Batch process results:', results);
}).catch(error => {
  console.error('Error running batch processes:', error);
});
