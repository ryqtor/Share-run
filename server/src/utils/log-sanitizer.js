const chalk = require('chalk');

/**
 * Vercel-Style Log Sanitizer (Server-Side)
 * 
 * - Strips all ISO/Docker timestamps
 * - Filters infrastructure noise
 * - Adds premium "Vercel Look" icons
 */
function sanitize(line) {
  if (!line || typeof line !== 'string') return line;

  // 1. Robust Timestamp Stripping (handles Docker's high precision)
  // Matches: 2026-03-13T22:00:47.689820302Z or 2026-03-13T22:00:47Z
  let cleanLine = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, '');
  
  // 2. Filter Noise
  const noisePatterns = [
    /telemetry/i,
    /anonymous usage/i,
    /Step \d+\/\d+/i,
    /Using cache/i,
    /Removing intermediate container/i,
    /--->/ // Docker build progress
  ];
  
  if (noisePatterns.some(pattern => pattern.test(cleanLine))) {
    return null;
  }

  cleanLine = cleanLine.trim();
  if (!cleanLine) return null;

  // 3. Vercel Look & Feel (Icons)
  // If the line already has an icon from a previous run/proxy, don't double it
  if (cleanLine.startsWith('○') || cleanLine.startsWith('✓') || cleanLine.startsWith('⨯')) {
    return cleanLine;
  }

  if (cleanLine.startsWith('GET')) {
    return `${chalk.cyan('○')} ${cleanLine}`;
  }
  
  const lower = cleanLine.toLowerCase();
  if (lower.includes('success') || lower.includes('ready') || lower.includes('compiled')) {
    return `${chalk.green('✓')} ${cleanLine}`;
  }
  
  if (lower.includes('error') || lower.includes('failed') || lower.includes('crash') || lower.includes('syntax')) {
    return `${chalk.red.bold('⨯')} ${cleanLine}`;
  }

  return cleanLine;
}

module.exports = { sanitize };
