// ================================
//  SERVER API: GENIUS + TMDB (Unified)
// ================================

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { Client as GeniusClient } from "genius-lyrics";

const app = express();
app.use(cors());
app.use(express.json());

// ================================
//   GENIUS CONFIG
// ================================
const Genius = new GeniusClient();
const lyricsCache = new Map();

// ================================
//   TMDB CONFIG
// ================================
const TMDB_API_KEY =
  process.env.TMDB_API_KEY || "8e2a8bd8a2d86bf25a910ded071e59d9";
const TMDB_BASE = "https://api.themoviedb.org/3";

// ================================
//   HELPERS
// ================================

function sanitize(str) {
  return str.replace(/[^\w\s]/gi, "").trim();
}

function mapMovieData(movie) {
  return {
    id: movie.id,
    title: movie.title,
    overview: movie.overview,
    releaseDate: movie.release_date,
    rating: movie.vote_average,
    votes: movie.vote_count,
    popularity: movie.popularity,
    language: movie.original_language,
    poster: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : null,
    backdrop: movie.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
      : null,
  };
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ================================
//   GENIUS FUNCTIONS
// ================================
async function fetchLyrics(query) {
  const cleaned = sanitize(query);

  if (lyricsCache.has(cleaned)) {
    console.log("CACHE HIT:", cleaned);
    return lyricsCache.get(cleaned);
  }

  console.log("SEARCH GENIUS:", cleaned);

  const result = await Genius.songs.search(cleaned).catch(() => null);
  if (!result?.length) return null;

  const song = result[0];
  const raw = await song.lyrics().catch(() => null);
  if (!raw) return null;

  const sections = [
    "Verse",
    "Chorus",
    "Refrain",
    "Bridge",
    "Outro",
    "Intro",
    "Pre-Chorus",
  ];

  const sectionRegex = new RegExp(`\\[(${sections.join("|")})`, "i");
  let finalLyrics = raw;

  // ✂️ potong sebelum bagian lirik pertama
  const firstSectionIndex = raw.search(sectionRegex);
  if (firstSectionIndex > 0) {
    finalLyrics = raw.slice(firstSectionIndex);
  }

  // 🧹 buang metadata yang tersisa
  finalLyrics = finalLyrics
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      if (!text) return false;

      // skip junk
      if (
        /Contributors|Translations|Read More|Español|You might also like|Lyrics by|Produced by|Genius/i.test(
          text
        )
      )
        return false;

      // buang narasi panjang
      if (text.length > 120 && !/\[.*?\]/.test(text)) return false;

      return true;
    })
    .join("\n")
    // biar format rapi
    .replace(/(\[.*?\])/g, "\n$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const data = {
    source: "genius.com",
    title: song.title,
    artist: song.artist.name,
    lyrics: finalLyrics,
  };

  lyricsCache.set(cleaned, data);
  return data;
}
// ================================
//   API ENDPOINTS
// ================================

// 🎤 Lyrics Finder
app.get("/lyrics", async (req, res) => {
  const artist = req.query.artist || "";
  const title = req.query.title || "";
  if (!title) return res.status(400).json({ error: "title is required" });

  const query = artist ? `${artist} ${title}` : title;
  const data = await fetchLyrics(query);

  res.json(data || { error: "Lyrics not found" });
});

// 🎬 Movie Finder (single)
app.get("/movie", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "q is required" });

  const url = `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
    q
  )}`;
  const data = await safeFetchJson(url);

  if (!data?.results?.length) return res.json({ error: "Movie not found" });

  res.json(mapMovieData(data.results[0]));
});

// 🎬 Movie Finder (multiple)
app.get("/movies/search", async (req, res) => {
  const q = req.query.q;
  const page = req.query.page || 1;
  if (!q) return res.status(400).json({ error: "q is required" });

  const url = `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
    q
  )}&page=${page}`;
  const data = await safeFetchJson(url);

  res.json({
    page: data.page,
    totalPages: data.total_pages,
    totalResults: data.total_results,
    results: data.results?.map(mapMovieData) || [],
  });
});

// 🔍 Movie detail by ID
app.get("/movie/:id", async (req, res) => {
  const id = req.params.id;

  const url = `${TMDB_BASE}/movie/${id}?api_key=${TMDB_API_KEY}`;
  const data = await safeFetchJson(url);

  if (!data) return res.json({ error: "Movie not found" });

  res.json(mapMovieData(data));
});

// 🔥 Trending movies today
app.get("/trending", async (req, res) => {
  const url = `${TMDB_BASE}/trending/movie/day?api_key=${TMDB_API_KEY}`;
  const data = await safeFetchJson(url);

  res.json(data?.results?.map(mapMovieData) || []);
});

// ================================
//   START SERVER
// ================================
app.listen(3000, () => {
  console.log("💡 API Server running → http://localhost:3000");
});
