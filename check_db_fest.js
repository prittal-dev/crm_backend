const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crm';

mongoose.connect(MONGO_URI).then(async () => {
    const projs = await mongoose.connection.db.collection('projects').find({ 'dailyLogs': { $exists: true, $ne: [] } }).toArray();
    console.log('Projects with dailyLogs:', projs.length);
    for (const p of projs) {
        const festLogs = (p.dailyLogs || []).filter(l => l && l.taskName && (l.taskName.includes('Independence') || l.taskName.includes('Rakhi') || l.taskName.includes('Festival')));
        if (festLogs.length > 0) {
            console.log('Project:', p.brandName || p.companyName || p.name);
            console.log('Fest logs:', JSON.stringify(festLogs, null, 2));
        }
    }
    const tasks = await mongoose.connection.db.collection('productiontasks').find({}).toArray();
    console.log('Total productiontasks in DB:', tasks.length);
    tasks.forEach(t => console.log('Task:', t.name, 'dueDate:', t.dueDate, 'monthNumber:', t.monthNumber, 'weekNumber:', t.weekNumber, 'status:', t.status));
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
