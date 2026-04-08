// Motivational Productivity Widget for Scriptable
// A beautiful widget to keep you motivated and on track with your goals

const quotes = [
  "The only way to do great work is to love what you do. - Steve Jobs",
  "Success is not final, failure is not fatal. - Winston Churchill",
  "You miss 100% of the shots you don't take. - Wayne Gretzky",
  "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt",
  "It does not matter how slowly you go as long as you do not stop. - Confucius",
  "Believe you can and you're halfway there. - Theodore Roosevelt",
  "The only impossible journey is the one you never begin. - Tony Robbins",
  "Your limitation—it's only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Sometimes we're tested not to show our weaknesses, but to discover our strengths.",
  "Don't watch the clock; do what it does. Keep going. - Sam Levenson",
  "The best time to plant a tree was 20 years ago. The second best time is now.",
  "Believe in yourself and all that you are.",
  "What lies behind us and what lies before us are tiny matters compared to what lies within us.",
];

const productivityTips = [
  "🎯 Break tasks into smaller goals",
  "⏱️ Use the Pomodoro technique (25min focus)",
  "💧 Drink water - stay hydrated",
  "📱 Minimize distractions on your phone",
  "✅ Check off one thing today",
  "🧠 Take a 5-minute break",
  "📝 Plan tomorrow's top 3 tasks",
  "🚶 Take a quick walk",
  "🎵 Focus music can boost productivity",
  "😴 Good sleep = better productivity",
];

// Create the widget
let widget = new ListWidget();
widget.backgroundColor = new Color("#1a1a2e");
widget.setPadding(16, 16, 16, 16);

// Time and greeting
let now = new Date();
let hours = now.getHours();
let greeting = hours < 12 ? "Good Morning" : hours < 18 ? "Good Afternoon" : "Good Evening";

let greetingText = widget.addText(greeting);
greetingText.font = Font.boldSystemFont(20);
greetingText.textColor = Color.white();
greetingText.lineLimit = 1;

// Date
let dateFormatter = new DateFormatter();
dateFormatter.dateFormat = "EEEE, MMMM d";
let dateText = widget.addText(dateFormatter.string(now));
dateText.font = Font.systemFont(14);
dateText.textColor = new Color("#a8dadc");
dateText.lineLimit = 1;

widget.addSpacer(12);

// Motivational quote
let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
let quoteText = widget.addText(randomQuote);
quoteText.font = Font.italicSystemFont(13);
quoteText.textColor = new Color("#f1faee");
quoteText.lineLimit = 4;

widget.addSpacer(12);

// Productivity tip
let randomTip = productivityTips[Math.floor(Math.random() * productivityTips.length)];
let tipText = widget.addText(randomTip);
tipText.font = Font.boldSystemFont(12);
tipText.textColor = new Color("#a8dadc");
tipText.lineLimit = 2;

widget.addSpacer(8);

// Current time (centered)
let timeFormatter = new DateFormatter();
timeFormatter.timeFormat = "h:mm a";
let timeText = widget.addText(timeFormatter.string(now));
timeText.font = Font.monospacedSystemFont(16, Font.Weight.semibold);
timeText.textColor = new Color("#e63946");
timeText.centerAlignText();
timeText.lineLimit = 1;

// Set up widget refresh
if (!config.isWidget) {
  // Preview in app
  widget.presentMedium();
} else {
  // As widget
  Script.setWidget(widget);
  Script.complete();
}

// Request refresh every 5 minutes
Script.setWidget(widget);
Script.complete();