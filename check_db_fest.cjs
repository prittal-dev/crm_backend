const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

mongoose.connect(MONGO_URI).then(async () => {
    const projs = await mongoose.connection.db.collection('projects').find({}).toArray();
    console.log('Total projects in DB:', projs.length);
    for (const p of projs) {
        if (p.dailyLogs && p.dailyLogs.length > 0) {
            console.log('Project:', p.brandName || p.companyName || p.name, 'Logs count:', p.dailyLogs.length);
            const festLogs = p.dailyLogs.filter(l => l && (l.taskName || l.taskTitle || l.notes || l.postUrl || '').match(/Independence|Rakhi|Raksha/i));
            if (festLogs.length > 0) {
                console.log('Fest logs:', JSON.stringify(festLogs, null, 2));
            }
        }
    }
    const tasks = await mongoose.connection.db.collection('productiontasks').find({}).toArray();
    console.log('Total productiontasks in DB:', tasks.length);
    const festTasks = tasks.filter(t => (t.name || '').match(/Independence|Rakhi|Raksha/i));
    console.log('Fest tasks in DB:', JSON.stringify(festTasks, null, 2));
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
