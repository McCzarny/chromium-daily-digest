import React from 'react';
import { StructuredSummary, GitilesCommit } from '../types';

interface SummaryDisplayProps {
  summary: StructuredSummary;
  allCommits: GitilesCommit[];
  filteredCommits: GitilesCommit[];
}

const GITHUB_COMMIT_URL = 'https://github.com/chromium/chromium/commit/';

const CommitLink: React.FC<{ hash: string }> = ({ hash }) => (
  <a 
    href={`${GITHUB_COMMIT_URL}${hash}`} 
    target="_blank" 
    rel="noopener noreferrer" 
    className="text-sky-500 hover:text-sky-300 text-xs ml-2 font-mono"
  >
    ({hash.substring(0, 7)})
  </a>
);

export const SummaryDisplay: React.FC<SummaryDisplayProps> = ({ summary, allCommits, filteredCommits }) => {
  const filteredCommitHashes = new Set(filteredCommits.map(c => c.commit));

  // A simple markdown-to-html converter for the overview text.
  const renderOverview = (text: string) => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const [fullMatch, linkText, url] = match;
      const hash = url.split('/').pop() ?? '';
      parts.push(
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-300 font-mono">
          ({hash.substring(0, 7)})
        </a>
      );
      lastIndex = match.index + fullMatch.length;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return <p>{parts}</p>;
  }
  
  // A simple markdown-to-html converter for list item text.
  const renderPointText = (text: string) => {
     const codeRegex = /`([^`]+)`/g;
     const parts = text.split(codeRegex);
     return parts.map((part, index) => 
        index % 2 === 1 
          ? <code key={index} className="bg-gray-700 text-pink-400 rounded px-2 py-1 text-sm font-mono">{part}</code> 
          : part
     );
  };


  return (
    <div className="prose prose-invert max-w-none w-full">
      <h2 className="text-3xl font-bold text-white mb-6">{summary.title}</h2>
      
      <div className="bg-gray-800 p-4 rounded-lg mb-6 shadow-inner border border-gray-700">
        <h3 className="text-xl font-semibold text-white mb-2">Overview</h3>
        <div className="text-gray-300">{renderOverview(summary.overview)}</div>
      </div>
      
      {summary.categories.map((category) => (
        <div key={category.title}>
          <h3 className="text-2xl font-semibold text-sky-400 mt-6 mb-4">{category.title}</h3>
          <ul className="list-disc list-inside space-y-3">
            {category.points.map((point, index) => (
              <li key={index} className="text-gray-300">
                {renderPointText(point.text)}
                {point.commits.map(hash => <CommitLink key={hash} hash={hash} />)}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <details className="mt-12 bg-gray-900/50 rounded-lg p-4 border border-gray-700">
        <summary className="cursor-pointer text-lg font-semibold text-white hover:text-sky-400">
          All Commits ({allCommits.length})
        </summary>
        <ul className="mt-4 space-y-2 text-sm font-mono">
          {allCommits.map(commit => {
            const isIncluded = filteredCommitHashes.has(commit.commit);
            const commitMessageFirstLine = commit.message.split('\n')[0];
            return (
              <li key={commit.commit} className={`flex items-baseline ${!isIncluded ? 'text-gray-500' : ''}`}>
                <a href={`${GITHUB_COMMIT_URL}${commit.commit}`} target="_blank" rel="noopener noreferrer" className={`hover:underline ${isIncluded ? 'text-sky-500' : 'text-gray-600'}`}>
                  {commit.commit.substring(0, 7)}
                </a>
                <span className={`ml-3 ${!isIncluded ? 'line-through' : ''}`}>{commitMessageFirstLine}</span>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
};
