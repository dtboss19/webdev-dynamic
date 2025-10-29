import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import { default as express } from 'express';
import { default as sqlite3 } from 'sqlite3';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const root = path.join(__dirname, 'public');
const template = path.join(__dirname, 'templates');

let app = express();
app.use(express.static(root));

// Database connection (economic freedom dataset)
const dbPath = path.join(__dirname, 'economic_data.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database economic_data.db');
    }
});


// Helper method to read template file
function readTemplate(filename) {
    return fs.readFileSync(path.join(template, filename), 'utf8');
}

// Helper method to render templates
function renderTemplate(templateContent, data) {
    let rendered = templateContent;
    for (const [key, value] of Object.entries(data)) {
        const placeholder = `{{${key}}}`;
        rendered = rendered.replace(new RegExp(placeholder, 'g'), value ?? '');
    }
    return rendered;
}

// Home page
app.get('/', (req, res) => {
    const templateContent = readTemplate('index.html');
    const data = {
        title: 'Economic Freedom Explorer',
        pageTitle: 'Economic Freedom Explorer',
        description: 'Browse economic freedom metrics by country and year.',
    };
    res.send(renderTemplate(templateContent, data));
});

// Route 1: Year view - list countries for a given year with key metrics
app.get('/year/:year', (req, res) => {
    const yearParam = req.params.year;

    // Get available years for prev/next
    const yearsSql = `SELECT DISTINCT year AS y FROM economic_data ORDER BY y`;
    db.all(yearsSql, [], (eYears, yearRows) => {
        if (eYears) return res.status(500).send('Database error: ' + eYears.message);
        const years = yearRows.map(r => r.y);
        const target = isNaN(Number(yearParam)) ? yearParam : Number(yearParam);
        const idx = years.indexOf(target);
        if (idx === -1) {
            return res.status(404).send(`Error: no data for year ${yearParam}`);
        }
        const prevYear = years[(idx - 1 + years.length) % years.length];
        const nextYear = years[(idx + 1) % years.length];

        const sql = `
            SELECT
                 country,
                 year,
                 economic_freedom_summary_index as FreedomIndex
            FROM economic_data
            WHERE year = ?
            ORDER BY FreedomIndex DESC, country ASC
        `
        db.all(sql, [yearParam], (eData, rows) => {
            if (eData) return res.status(500).send('Database error: ' + eData.message);
            if (!rows || rows.length === 0) return res.status(404).send(`Error: no data for year ${yearParam}`);

            const tableRows = rows.map(r => `
                <tr>
                    <td>${r.country ?? 'N/A'}</td>
                    <td>${r.FreedomIndex ?? 'N/A'}</td>
                </tr>
            `).join('');

            // Simple chart: top 10 by freedom index
            const top = rows
              .slice()
              .sort((a, b) => Number(b.FreedomIndex ?? 0) - Number(a.FreedomIndex ?? 0))
              .slice(0, 10);
            const labels = top.map(r => String(r.country).replace(/"/g, '\\"'));
            const values = top.map(r => Number(r.FreedomIndex ?? 0));

            const templateContent = readTemplate('year.html');
            const data = {
                title: `Year ${yearParam} — Economic Freedom`,
                pageTitle: `Year ${yearParam}`,
                year: String(yearParam),
                tableRows,
                prevLink: `/year/${prevYear}`,
                nextLink: `/year/${nextYear}`,
                chartLabels: JSON.stringify(labels),
                chartData: JSON.stringify(values),
            };
            res.send(renderTemplate(templateContent, data));
        });
    });
});

// Route 2: Freedom view by country 
app.get('/country/:country', (req, res) => {
    const countryParam = req.params.country;

    // Distinct countries for prev/next
    const countriesSql = `SELECT DISTINCT country AS c FROM economic_data ORDER BY c`;
    db.all(countriesSql, [], (eC, countryRows) => {
        if (eC) return res.status(500).send('Database error: ' + eC.message);
        const countries = countryRows.map(r => r.c);
        const idx = countries.findIndex(c => String(c).toLowerCase() === String(countryParam).toLowerCase());
        if (idx === -1) {
            return res.status(404).send(`Error: no data for country ${countryParam}`);
        }
        const prev = countries[(idx - 1 + countries.length) % countries.length];
        const next = countries[(idx + 1) % countries.length];

        const sql = `
            SELECT
              country,
              year,
              economic_freedom_summary_index as FreedomIndex
            FROM economic_data
            WHERE lower(country) = lower(?)
            ORDER BY FreedomIndex DESC, year DESC
        `;
        db.all(sql, [countryParam], (eData, rows) => {
            if (eData) return res.status(500).send('Database error: ' + eData.message);
            if (!rows || rows.length === 0) return res.status(404).send(`Error: no data for country ${countryParam}`);

            const tableRows = rows.map(r => `
                <tr>
                    <td>${r.year ?? 'N/A'}</td>
                    <td>${r.FreedomIndex ?? 'N/A'}</td>
                </tr>
            `).join('');

            const labels = rows.map(r => r.year);
            const values = rows.map(r => Number(r.FreedomIndex ?? 0));

            const templateContent = readTemplate('country.html');
            const data = {
                title: `Freedom — ${rows[0].country}`,
                pageTitle: `Freedom Scores: ${rows[0].country}`,
                tableRows,
                prevLink: `/country/${encodeURIComponent(prev)}`,
                nextLink: `/country/${encodeURIComponent(next)}`,
                chartLabels: JSON.stringify(labels),
                chartData: JSON.stringify(values),
            };
            res.send(renderTemplate(templateContent, data));
        });
    });
});

// Route 3: Ranked Countries (by freedom index across years)
app.get('/rank/:rank', (req, res) => {
    const rankParam = req.params.rank;

    // Distinct ranks for prev/next
    const rankSql = `SELECT DISTINCT rank AS c FROM economic_data ORDER BY c`;
    db.all(rankSql, [], (eC, rankRows) => {
        if (eC) return res.status(500).send('Database error: ' + eC.message);
        const ranks = rankRows.map(r => r.c);
        const numericRank = Number(rankParam);
        const idx = ranks.indexOf(isNaN(numericRank) ? rankParam : numericRank);
        if (idx === -1) {
            return res.status(404).send(`Error: no data for rank ${rankParam}`);
        }
        const prev = ranks[(idx - 1 + ranks.length) % ranks.length];
        const next = ranks[(idx + 1) % ranks.length];

        const sql = `
            SELECT
               year,
               country,
               economic_freedom_summary_index as FreedomIndex
            FROM economic_data
            WHERE rank = ?
            ORDER BY year
        `;
        db.all(sql, [rankParam], (eData, rows) => {
            if (eData) return res.status(500).send('Database error: ' + eData.message);
            if (!rows || rows.length === 0) return res.status(404).send(`Error: no data for rank ${rankParam}`);

            const tableRows = rows.map(r => `
                <tr>
                    <td>${r.year ?? 'N/A'}</td>
                    <td>${r.country ?? 'N/A'}</td>
                    <td>${r.FreedomIndex ?? 'N/A'}</td>
                </tr>
            `).join('');

            const labels = rows.map(r => r.year);
            const values = rows.map(r => Number(r.FreedomIndex ?? 0));

            const templateContent = readTemplate('rank.html');
            const data = {
                title: `Rank ${rankParam} — Economic Freedom` ,
                pageTitle: `Rank ${rankParam} across years`,
                tableRows,
                prevLink: `/rank/${encodeURIComponent(prev)}`,
                nextLink: `/rank/${encodeURIComponent(next)}`,
                chartLabels: JSON.stringify(labels),
                chartData: JSON.stringify(values),
            };
            res.send(renderTemplate(templateContent, data));
        });
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

app.listen(port, () => {
    console.log('Now listening on port ' + port);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});