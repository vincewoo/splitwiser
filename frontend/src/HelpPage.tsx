import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from './hooks/usePageTitle';

interface FAQSection {
  id: string;
  title: string;
  icon: string;
  items: {
    question: string;
    answer: string | string[];
  }[];
}

const HelpPage: React.FC = () => {
  usePageTitle('Help & FAQ');
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['currency']));
  const [searchQuery, setSearchQuery] = useState('');

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const sections: FAQSection[] = [
    {
      id: 'currency',
      title: 'Currency & Exchange Rates',
      icon: '💱',
      items: [
        {
          question: 'How does currency conversion work?',
          answer: [
            'Splitwiser uses a unique historical exchange rate caching system to ensure accurate expense tracking over time.',
            '',
            '• When you create an expense: The exchange rate from that expense\'s date is automatically fetched and cached with the expense.',
            '• Why this matters: Exchange rates change daily. Without caching historical rates, old expenses would be converted using today\'s rates, making your balance history inaccurate.',
            '• When viewing balances: Current exchange rates are used for display conversion, but each expense retains its original historical rate.',
            '',
            'Example: If you spent €100 in January when 1 EUR = 1.10 USD, that expense is permanently stored with that rate. Even if the euro falls to 1.05 USD later, your January expense still shows as $110.'
          ]
        },
        {
          question: 'What currencies are supported?',
          answer: [
            'Splitwiser supports 7 major world currencies:',
            '',
            '🇺🇸 USD - US Dollar',
            '🇪🇺 EUR - Euro',
            '🇬🇧 GBP - British Pound',
            '🇯🇵 JPY - Japanese Yen',
            '🇨🇦 CAD - Canadian Dollar',
            '🇨🇳 CNY - Chinese Yuan (Renminbi)',
            '🇭🇰 HKD - Hong Kong Dollar',
            '',
            'Currency selectors show your recently-used currencies first for faster selection.'
          ]
        },
        {
          question: 'Where do exchange rates come from?',
          answer: [
            'We use the Frankfurter API (https://frankfurter.app), which provides:',
            '',
            '• Free, no API key required',
            '• Historical rates back to 1999',
            '• Data from the European Central Bank',
            '• Reliable and maintained by the open-source community',
            '',
            'If the API is unavailable, we fall back to hardcoded rates so the app continues to work offline.'
          ]
        },
        {
          question: 'What is a group\'s default currency?',
          answer: [
            'Each group has a default currency that streamlines expense management:',
            '',
            '• Expense pre-fill: When adding an expense in a group, the currency automatically defaults to the group\'s currency',
            '• Balance viewing: Toggle to view all balances converted to the group\'s default currency',
            '• Change anytime: You can update a group\'s default currency in the Edit Group settings',
            '',
            'This is especially useful for groups where everyone uses the same currency most of the time.'
          ]
        },
        {
          question: 'How do I view balances in a single currency?',
          answer: [
            'On the group detail page, look for the "Show in [CURRENCY]" toggle button.',
            '',
            '• Default view: Balances are grouped by currency with separate sections',
            '• Converted view: All balances are converted to the group\'s default currency',
            '',
            'Example: If you owe Alice $50 USD and €20 EUR, the converted view might show "You owe Alice $73.30" (using current exchange rates).'
          ]
        }
      ]
    },
    {
      id: 'expenses',
      title: 'Expense Splitting',
      icon: '💰',
      items: [
        {
          question: 'What split types are available?',
          answer: [
            'Splitwiser offers 5 flexible ways to split expenses:',
            '',
            '1. Equal Split: Divide evenly among all participants',
            '2. Exact Amounts: Specify exact dollar amounts for each person',
            '3. Percentage: Allocate by percentage (must total 100%)',
            '4. Shares: Divide by shares (e.g., 2 shares to Alice, 1 to Bob)',
            '5. Itemized: Split by individual items (perfect for restaurant bills)',
            '',
            'Choose the method that best fits your expense type.'
          ]
        },
        {
          question: 'How does itemized splitting work?',
          answer: [
            'Itemized splitting is ideal for restaurant bills and shopping trips:',
            '',
            '1. Add items manually or scan a receipt',
            '2. Assign each item to one or more people (shared items split equally)',
            '3. Mark tax/tip items separately',
            '4. Tax/tip is distributed proportionally based on each person\'s subtotal',
            '',
            'Example: If Alice ordered $15 of food and Bob ordered $10, and there\'s $5 tax/tip:',
            '• Total food: $25',
            '• Alice\'s portion of tax/tip: ($15 / $25) × $5 = $3',
            '• Bob\'s portion of tax/tip: ($10 / $25) × $5 = $2',
            '• Alice owes: $18, Bob owes: $12'
          ]
        },
        {
          question: 'Can I add notes to expenses?',
          answer: 'Yes! Every expense has a Notes field where you can add details, context, or reminders about the expense. Notes are visible to all group members.'
        },
        {
          question: 'Can I attach receipt images?',
          answer: [
            'Yes! Splitwiser supports receipt scanning:',
            '',
            '• Take a photo or upload an image when creating an expense',
            '• OCR (Optical Character Recognition) automatically extracts items and prices',
            '• Review and edit the extracted items before saving',
            '• Receipt images are stored with the expense for future reference',
            '',
            'Note: Receipt scanning requires an internet connection and Google Cloud Vision API.'
          ]
        },
        {
          question: 'What happens if I edit an expense?',
          answer: [
            'When you edit an expense:',
            '',
            '• If you change the date or currency, the historical exchange rate is automatically re-fetched for the new date/currency',
            '• All splits are recalculated based on the new amounts',
            '• Balances are updated across all affected participants',
            '• The expense history is preserved'
          ]
        }
      ]
    },
    {
      id: 'groups',
      title: 'Groups & Members',
      icon: '👥',
      items: [
        {
          question: 'What\'s the difference between members and guests?',
          answer: [
            'Splitwiser supports two types of participants:',
            '',
            'Splitwisers (Registered Members):',
            '• Have their own account with email/password',
            '• Can log in and see all their groups',
            '• Can create groups and add expenses',
            '• Balances sync across all their groups',
            '',
            'Guests (Non-registered):',
            '• Added by name only (no account required)',
            '• Participate in expenses like regular members',
            '• Can later "claim" their profile to become a registered user',
            '• Perfect for casual participants or one-time events'
          ]
        },
        {
          question: 'How do I add a guest to a group?',
          answer: [
            'Adding a guest is simple:',
            '',
            '1. Open the group',
            '2. Click "Add Guest" in the Guests section',
            '3. Enter their name',
            '4. Click Add',
            '',
            'The guest can now be selected as a payer or participant in expenses.'
          ]
        },
        {
          question: 'What is guest claiming?',
          answer: [
            'Guest claiming lets someone convert a guest profile to a registered account:',
            '',
            '1. A guest (like "Bob\'s Friend") participates in several expenses',
            '2. Later, that person registers for an account',
            '3. They can "claim" the guest profile',
            '4. All expenses transfer to their registered account',
            '5. They\'re automatically added to the group',
            '',
            'This preserves all expense history while giving them full access to Splitwiser features.'
          ]
        },
        {
          question: 'What is member/guest management?',
          answer: [
            'Management lets you link members or guests together for combined balance viewing:',
            '',
            'Use case: You and your partner want to see your combined balance',
            '',
            '1. Go to the group',
            '2. Click "Manage" next to the person',
            '3. Select who manages them',
            '4. Their balance now aggregates with the manager\'s balance',
            '',
            'Example: If Alice manages Bob, the balance view shows "Alice: $100 (Includes: Bob)"',
            '',
            'Note: Individual expenses still show separately - only the balance summary is combined.'
          ]
        },
        {
          question: 'Can I share a group with non-users?',
          answer: [
            'Yes! Enable public sharing for read-only group access:',
            '',
            '1. Open group settings',
            '2. Toggle "Enable public sharing"',
            '3. Share the generated link',
            '',
            'Anyone with the link can view:',
            '• Group balances',
            '• All expenses',
            '• Expense details',
            '',
            'They cannot:',
            '• Edit or delete anything',
            '• Add expenses',
            '• See member email addresses',
            '',
            'Perfect for sharing trip expenses with family or roommates who don\'t want to create accounts.'
          ]
        },
        {
          question: 'Can I customize group appearance?',
          answer: 'Yes! When creating or editing a group, you can choose an emoji icon to help visually distinguish groups. You can also set a default currency for the group.'
        }
      ]
    },
    {
      id: 'balances',
      title: 'Balances & Settlement',
      icon: '⚖️',
      items: [
        {
          question: 'How are balances calculated?',
          answer: [
            'Balances use a simple principle:',
            '',
            '• Positive balance (green): You are owed money',
            '• Negative balance (red): You owe money',
            '• Zero balance: All settled up',
            '',
            'For each expense:',
            '• The payer gets credited for the full amount',
            '• Each participant gets debited for their share',
            '',
            'Example: Alice pays $30 for lunch, split 3 ways ($10 each):',
            '• Alice: +$30 (paid) -$10 (her share) = +$20 balance',
            '• Bob: -$10 balance',
            '• Charlie: -$10 balance'
          ]
        },
        {
          question: 'What is debt simplification?',
          answer: [
            'Debt simplification reduces the number of transactions needed to settle a group:',
            '',
            'Example without simplification:',
            '• Alice owes Bob $10',
            '• Alice owes Charlie $10',
            '• Bob owes Charlie $20',
            '= 3 transactions totaling $40',
            '',
            'Example with simplification:',
            '• Alice owes Charlie $20',
            '• Bob owes Charlie $10',
            '= 2 transactions totaling $30',
            '',
            'How to use:',
            '1. Open a group with balances',
            '2. Scroll to the Group Balances section',
            '3. Click the "Simplify Debts" button',
            '4. View the optimized payment plan',
            '5. Copy to clipboard to share with group members',
            '',
            'The payment plan uses your group\'s default currency. For multi-currency groups, all balances are automatically converted using historical exchange rates to calculate the optimal transactions.'
          ]
        },
        {
          question: 'How do managed member balances work?',
          answer: [
            'When a member or guest is managed by someone:',
            '',
            '• Balance view: Shows combined total (e.g., "Alice: $50 (Includes: Bob)")',
            '• Expense details: Still shows individual transactions',
            '• Calculations: Each person\'s splits are tracked separately',
            '',
            'This is purely a display feature - it doesn\'t change how expenses are split or recorded.'
          ]
        },
        {
          question: 'Can I settle up without recording an expense?',
          answer: [
            'Yes! Use the "Settle Up" feature:',
            '',
            '1. Click "Settle up" button',
            '2. Select who paid whom',
            '3. Enter the amount and currency',
            '4. Click Settle Up',
            '',
            'This records a payment (zero-split expense) that adjusts balances without splitting costs.'
          ]
        }
      ]
    },
    {
      id: 'pwa',
      title: 'Offline & Mobile Features',
      icon: '📱',
      items: [
        {
          question: 'Can I use Splitwiser offline?',
          answer: [
            'Yes! Splitwiser is a Progressive Web App (PWA) with offline support:',
            '',
            'Offline capabilities:',
            '• View cached groups and balances',
            '• Create and edit expenses (syncs when back online)',
            '• Currency conversion using cached rates',
            '• All data stored locally in your browser',
            '',
            'Requires internet:',
            '• Receipt scanning (Google Cloud Vision API)',
            '• Fetching new exchange rates',
            '• Syncing with other group members'
          ]
        },
        {
          question: 'Can I install Splitwiser as an app?',
          answer: [
            'Yes! Install Splitwiser on your device:',
            '',
            'iOS (iPhone/iPad):',
            '1. Open in Safari',
            '2. Tap the Share button',
            '3. Select "Add to Home Screen"',
            '',
            'Android:',
            '1. Open in Chrome',
            '2. Tap the menu (3 dots)',
            '3. Select "Install app" or "Add to Home screen"',
            '',
            'Desktop (Chrome/Edge):',
            '1. Look for the install icon in the address bar',
            '2. Click "Install"',
            '',
            'The app will launch like a native app without browser chrome.'
          ]
        },
        {
          question: 'How does sync work?',
          answer: [
            'Splitwiser automatically syncs your data:',
            '',
            '• Online: All changes save immediately to the server',
            '• Offline: Changes queue locally and sync when connection restores',
            '• Sync status: Shows in the status bar at the bottom',
            '',
            'If you make changes offline, they\'ll automatically sync when you\'re back online. A sync indicator shows pending operations.'
          ]
        },
        {
          question: 'Is there a mobile app?',
          answer: [
            'Splitwiser is a web app optimized for mobile:',
            '',
            '• Responsive design works on all screen sizes',
            '• Touch-friendly buttons and gestures',
            '• Install as PWA for app-like experience',
            '• Works on iOS, Android, and desktop',
            '• No app store download needed',
            '',
            'Features like Web Share API integrate with your device\'s native sharing.'
          ]
        }
      ]
    },
    {
      id: 'account',
      title: 'Account & Security',
      icon: '🔒',
      items: [
        {
          question: 'How does authentication work?',
          answer: [
            'Splitwiser uses secure token-based authentication:',
            '',
            '• Access tokens: Short-lived (30 minutes), used for API requests',
            '• Refresh tokens: Long-lived (30 days), used to get new access tokens',
            '• Automatic refresh: Seamlessly renews your session',
            '• Secure storage: Tokens stored hashed in the database',
            '',
            'When you log out, your refresh token is revoked server-side to prevent reuse.'
          ]
        },
        {
          question: 'Is my data secure?',
          answer: [
            'Yes! Splitwiser implements several security measures:',
            '',
            '• Passwords hashed with bcrypt (never stored in plain text)',
            '• JWT tokens for authentication',
            '• Refresh tokens stored as SHA-256 hashes',
            '• HTTPS encryption for all data in transit',
            '• Server-side validation on all requests',
            '',
            'Your financial data is stored securely and only accessible to you and your group members.'
          ]
        },
        {
          question: 'Can I change my password?',
          answer: 'Password reset functionality is not currently implemented. If you need to change your password, please contact support or create a new account.'
        }
      ]
    },
    {
      id: 'tips',
      title: 'Tips & Best Practices',
      icon: '💡',
      items: [
        {
          question: 'What\'s the best way to organize expenses?',
          answer: [
            'Here are some recommended practices:',
            '',
            '• Use groups for different contexts (trips, roommates, projects)',
            '• Set appropriate default currencies for each group',
            '• Add descriptive expense names and notes',
            '• Use expense icons (emojis) to visually categorize',
            '• Scan receipts for itemized expenses (restaurants, shopping)',
            '• Settle up regularly to keep balances current',
            '• Use guest accounts for one-time participants'
          ]
        },
        {
          question: 'How should I handle multi-currency trips?',
          answer: [
            'For international trips:',
            '',
            '1. Create a group with a default currency (e.g., USD)',
            '2. Each person records expenses in the currency they actually paid',
            '3. Historical rates are cached automatically',
            '4. Use "Show in [currency]" to view total balances in one currency',
            '5. Click "Simplify Debts" at the end to get an optimal payment plan',
            '',
            'This preserves accurate records while making settlement simple. The debt simplification converts everything to your group\'s default currency and shows you the minimum number of transactions needed.'
          ]
        },
        {
          question: 'Can I use Splitwiser for business expenses?',
          answer: [
            'Yes, with some considerations:',
            '',
            'Good for:',
            '• Small team project expenses',
            '• Conference/travel cost splitting',
            '• Shared office supply purchases',
            '',
            'Not ideal for:',
            '• Formal accounting/bookkeeping',
            '• Tax reporting (no invoice management)',
            '• Large-scale corporate expense management',
            '',
            'For business use, keep receipts separate for your records and use notes to add context.'
          ]
        },
        {
          question: 'How do I handle someone who hasn\'t signed up yet?',
          answer: [
            'Use the guest feature:',
            '',
            '1. Add them as a guest by name',
            '2. Include them in expenses as normal',
            '3. When they\'re ready, they can register and claim their guest profile',
            '4. All their expense history transfers to their account',
            '',
            'This lets you start tracking expenses immediately without waiting for everyone to create accounts.'
          ]
        }
      ]
    },
    {
      id: 'dark-mode',
      title: 'Appearance',
      icon: '🌓',
      items: [
        {
          question: 'How do I enable dark mode?',
          answer: [
            'Toggle dark mode using the sun/moon icon in the sidebar footer:',
            '',
            '• Moon icon (light mode): Click to switch to dark mode',
            '• Sun icon (dark mode): Click to switch to light mode',
            '',
            'Your preference is saved automatically and persists across sessions.'
          ]
        },
        {
          question: 'Does dark mode work on mobile?',
          answer: 'Yes! Dark mode works on all devices and is fully integrated with the PWA. The app theme color updates to match your preference, providing a seamless experience.'
        }
      ]
    }
  ];

  // Filter sections based on search query
  const filteredSections = sections.map(section => ({
    ...section,
    items: section.items.filter(item => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      const questionMatch = item.question.toLowerCase().includes(query);
      const answerMatch = Array.isArray(item.answer)
        ? item.answer.join(' ').toLowerCase().includes(query)
        : item.answer.toLowerCase().includes(query);
      return questionMatch || answerMatch;
    })
  })).filter(section => section.items.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Back to dashboard"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Help & FAQ</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Everything you need to know about Splitwiser</p>
            </div>
          </div>
        </div>
      </header>

      {/* Search */}
      <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search help topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 pb-12 sm:px-6 lg:px-8">
        {filteredSections.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">No results found for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSections.map(section => (
              <div key={section.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{section.icon}</span>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{section.title}</h2>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({section.items.length} {section.items.length === 1 ? 'topic' : 'topics'})
                    </span>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${
                      expandedSections.has(section.id) ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {expandedSections.has(section.id) && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    {section.items.map((item, index) => (
                      <details key={index} className="group">
                        <summary className="cursor-pointer p-5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors list-none">
                          <div className="flex items-start gap-3">
                            <svg
                              className="w-5 h-5 text-teal-500 mt-0.5 group-open:rotate-90 transition-transform"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <h3 className="flex-1 font-medium text-gray-900 dark:text-gray-100">{item.question}</h3>
                          </div>
                        </summary>
                        <div className="px-5 pb-5 pl-12 pr-5">
                          {Array.isArray(item.answer) ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none text-gray-600 dark:text-gray-400">
                              {item.answer.map((paragraph, i) => (
                                <p key={i} className={paragraph === '' ? 'h-2' : 'mb-2 last:mb-0'}>
                                  {paragraph}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-gray-600 dark:text-gray-400">{item.answer}</p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Still have questions? Check out our{' '}
            <a
              href="https://github.com/vincewoo/splitwiser"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-500 hover:text-teal-600 dark:text-teal-400 dark:hover:text-teal-300 font-medium"
            >
              documentation
            </a>
            {' '}or{' '}
            <a
              href="https://github.com/vincewoo/splitwiser/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-500 hover:text-teal-600 dark:text-teal-400 dark:hover:text-teal-300 font-medium"
            >
              report an issue
            </a>
            .
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
            Splitwiser v1.0 • Made with care for splitting expenses
          </p>
        </div>
      </main>
    </div>
  );
};

export default HelpPage;
