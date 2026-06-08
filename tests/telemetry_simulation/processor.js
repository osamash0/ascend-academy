const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'telemetry.db');

// Remove existing db if it exists
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

function runScript(filePath) {
    const script = fs.readFileSync(path.join(__dirname, filePath), 'utf8');
    return new Promise((resolve, reject) => {
        db.exec(script, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function processBackend() {
    // 1. AI Interaction Filtering
    console.log('[Backend] Running AI Interaction NLP Filter...');
    await new Promise((resolve, reject) => {
        db.all("SELECT interaction_id, query_text FROM ai_interactions", (err, rows) => {
            if (err) return reject(err);
            const updates = rows.map(row => {
                // Simple keyword filter simulation
                const isRelevant = !row.query_text.toLowerCase().includes('hello ai');
                return new Promise((res, rej) => {
                    db.run("UPDATE ai_interactions SET is_subject_relevant = ? WHERE interaction_id = ?", [isRelevant ? 1 : 0, row.interaction_id], (err) => {
                        if (err) rej(err); else res();
                    });
                });
            });
            Promise.all(updates).then(resolve).catch(reject);
        });
    });

    // 2. Typology Classification
    console.log('[Backend] Running Typology Classification Engine...');
    await new Promise((resolve, reject) => {
        db.all(`
            SELECT s.student_id, AVG(a.score_percentage) as avg_score 
            FROM students s 
            LEFT JOIN assessments a ON s.student_id = a.student_id 
            GROUP BY s.student_id
        `, (err, rows) => {
            if (err) return reject(err);
            const updates = rows.map(row => {
                let typology = 'Average';
                if (row.avg_score >= 85) typology = 'Natural Learner';
                else if (row.avg_score < 50) typology = 'At Risk';
                
                return new Promise((res, rej) => {
                    db.run("UPDATE students SET typology = ? WHERE student_id = ?", [typology, row.student_id], (err) => {
                        if (err) rej(err); else res();
                    });
                });
            });
            Promise.all(updates).then(resolve).catch(reject);
        });
    });
}

function runQueryAndPrint(queryName, query) {
    return new Promise((resolve, reject) => {
        db.all(query, (err, rows) => {
            if (err) return reject(err);
            console.log(`\n--- ${queryName} ---`);
            console.table(rows);
            resolve();
        });
    });
}

async function runDashboardAnalytics() {
    console.log('\n[Dashboard] Aggregating Analytics...');
    const queries = fs.readFileSync(path.join(__dirname, 'analytics_dashboard.sql'), 'utf8').split(';');
    
    // Quick and dirty manual query mapping to match the test requirements exactly
    await runQueryAndPrint('Overview Panel', queries[0]);
    await runQueryAndPrint('Slide Performance Index (Slide 2)', queries[1]);
    await runQueryAndPrint('Confidence Map (Class-wide)', queries[2]);
    await runQueryAndPrint('Drop-off Data (Slide 2 Drop-off Rate)', queries[3]);
    await runQueryAndPrint('Student Typologies', queries[4]);
    await runQueryAndPrint('Filtered AI Queries', queries[5]);
}

async function main() {
    try {
        console.log('Initializing Database...');
        await runScript('schema.sql');
        console.log('Seeding Telemetry Data...');
        await runScript('seed_telemetry.sql');
        
        await processBackend();
        await runDashboardAnalytics();
        
        console.log('\nSimulation Complete.');
        db.close();
    } catch (err) {
        console.error('Error during simulation:', err);
    }
}

main();
