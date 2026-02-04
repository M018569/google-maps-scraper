require('dotenv').config();
const express = require('express');
const path = require('path');
const { ApifyClient } = require('apify-client');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Increase timeout for Apify searches (5 minutes)
app.use((req, res, next) => {
  res.setTimeout(300000);
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize Apify client
const getApifyClient = () => {
  const token = process.env.APIFY_API_TOKEN;
  if (!token || token === 'your_apify_api_token_here') {
    return null;
  }
  return new ApifyClient({ token });
};

// Routes

// Home/Search page
app.get('/', (req, res) => {
  res.render('search', { error: null });
});

// Search submission
app.post('/search', async (req, res) => {
  const { keyword, city, state, maxResults } = req.body;

  // Validate inputs
  const missingFields = [];
  if (!keyword?.trim()) missingFields.push('Keyword');
  if (!city?.trim()) missingFields.push('City');
  if (!state?.trim()) missingFields.push('State');

  if (missingFields.length > 0) {
    return res.render('error', {
      error: `Missing required fields: ${missingFields.join(', ')}`,
      message: 'Please fill in all required fields to search.'
    });
  }

  const client = getApifyClient();
  if (!client) {
    return res.render('error', {
      error: 'Apify API token not configured',
      message: 'Add your APIFY_API_TOKEN to the .env file (local) or Secrets tab (Replit). Get your token at: https://console.apify.com/account/integrations'
    });
  }

  try {
    const searchQuery = `${keyword.trim()} in ${city.trim()}, ${state.trim()}`;
    const limit = parseInt(maxResults) || 20;

    // Run the Apify actor
    const run = await client.actor('nwua9Gu5YrADL7ZDj').call({
      searchStringsArray: [searchQuery],
      maxCrawledPlacesPerSearch: limit,
      language: 'en',
      deeperCityScrape: false,
    });

    // Fetch results from the dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    // Map results to clean format
    const results = items.map(item => ({
      title: item.title || 'N/A',
      phone: item.phone || '',
      website: item.website || '',
      email: extractEmail(item),
      category: item.categoryName || item.categories?.[0] || '',
      address: item.address || '',
      city: item.city || city.trim(),
      state: item.state || state.trim(),
      rating: item.totalScore || 0,
      reviewCount: item.reviewsCount || 0,
      url: item.url || '',
      placeId: item.placeId || '',
    }));

    // Save search to database
    const searchKey = `search:${Date.now()}`;
    await db.set(searchKey, {
      query: keyword.trim(),
      location: `${city.trim()}, ${state.trim()}`,
      resultCount: results.length,
      results: results,
      date: new Date().toISOString()
    });

    res.render('results', {
      results,
      query: keyword.trim(),
      location: `${city.trim()}, ${state.trim()}`,
      searchKey
    });

  } catch (error) {
    console.error('Apify error:', error);

    let errorMessage = 'An error occurred while searching.';
    let errorDetail = error.message;

    if (error.statusCode === 401 || error.message?.includes('401')) {
      errorMessage = 'Invalid Apify API token';
      errorDetail = 'Your API token is invalid or expired. Check your token at: https://console.apify.com/account/integrations';
    } else if (error.statusCode === 402 || error.message?.includes('402')) {
      errorMessage = 'Insufficient Apify credits';
      errorDetail = 'You\'ve run out of Apify credits. Top up your account at: https://console.apify.com/billing';
    }

    res.render('error', { error: errorMessage, message: errorDetail });
  }
});

// Helper to extract email from Apify result
function extractEmail(item) {
  if (item.email) return item.email;
  if (item.emails?.length) return item.emails[0];
  // Try to extract from website or other fields
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const text = JSON.stringify(item);
  const match = text.match(emailRegex);
  return match ? match[0] : '';
}

// History page
app.get('/history', async (req, res) => {
  try {
    const keys = await db.list('search:');
    const searches = [];

    for (const key of keys) {
      const data = await db.get(key);
      if (data) {
        searches.push({
          key,
          ...data
        });
      }
    }

    // Sort by newest first
    searches.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.render('history', { searches });
  } catch (error) {
    console.error('History error:', error);
    res.render('error', { error: 'Failed to load history', message: error.message });
  }
});

// View saved search results
app.get('/history/:key', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const data = await db.get(key);

    if (!data) {
      return res.render('error', { error: 'Search not found', message: 'This search may have been deleted.' });
    }

    res.render('results', {
      results: data.results,
      query: data.query,
      location: data.location,
      searchKey: key,
      fromHistory: true
    });
  } catch (error) {
    console.error('View history error:', error);
    res.render('error', { error: 'Failed to load search', message: error.message });
  }
});

// Delete search from history
app.post('/history/delete/:key', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    await db.delete(key);
    res.redirect('/history');
  } catch (error) {
    console.error('Delete history error:', error);
    res.render('error', { error: 'Failed to delete search', message: error.message });
  }
});

// Leads page
app.get('/leads', async (req, res) => {
  try {
    const keys = await db.list('lead:');
    const leads = [];

    for (const key of keys) {
      const data = await db.get(key);
      if (data) {
        leads.push({
          key,
          ...data
        });
      }
    }

    // Sort by newest first
    leads.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

    res.render('leads', { leads });
  } catch (error) {
    console.error('Leads error:', error);
    res.render('error', { error: 'Failed to load leads', message: error.message });
  }
});

// Save lead API
app.post('/leads/save', async (req, res) => {
  try {
    const lead = req.body;
    const leadKey = `lead:${Date.now()}`;

    await db.set(leadKey, {
      ...lead,
      savedAt: new Date().toISOString()
    });

    res.json({ success: true, key: leadKey });
  } catch (error) {
    console.error('Save lead error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get saved leads (for checking bookmark state)
app.get('/leads/saved', async (req, res) => {
  try {
    const keys = await db.list('lead:');
    const leads = {};

    for (const key of keys) {
      const data = await db.get(key);
      if (data) {
        leads[data.title] = key;
      }
    }

    res.json(leads);
  } catch (error) {
    console.error('Get saved leads error:', error);
    res.status(500).json({});
  }
});

// Delete lead
app.post('/leads/delete/:key', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    await db.delete(key);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete lead by title (for unsaving from results page)
app.post('/leads/delete-by-title', async (req, res) => {
  try {
    const { title } = req.body;
    const keys = await db.list('lead:');

    for (const key of keys) {
      const data = await db.get(key);
      if (data && data.title === title) {
        await db.delete(key);
        return res.json({ success: true });
      }
    }

    res.json({ success: false, error: 'Lead not found' });
  } catch (error) {
    console.error('Delete lead by title error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
