import { BibleService } from './src/services/BibleService.js';
console.log(await BibleService.getVerses("창", 1));
