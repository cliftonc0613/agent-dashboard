---
name: storybrand-brandscript
description: This skill should be used when creating StoryBrand messaging and website copy. It guides users through a conversational Q&A process based on Donald Miller's 7-part StoryBrand framework, then generates compelling copy for each homepage section. Outputs to context/core/storybrand-brandscript.json.
---

# StoryBrand BrandScript Creator

## Purpose

This skill creates a complete StoryBrand BrandScript by asking conversational questions about your business, customers, and transformation. It then generates ready-to-use website copy for all StoryBrand homepage sections.

## When to Use This Skill

Use this skill when:
- Creating messaging for a new website or homepage redesign
- Clarifying your brand's story and positioning
- Generating copy for the StoryBrand wireframe components
- Helping a client articulate their value proposition
- Preparing content for marketing materials

## Pre-Requisites

Before starting, check if the client has completed the **StoryBrand Client Worksheet** located at `knowledge/worksheets/storybrand-client-worksheet.md`. If they have, you can use their answers to speed up the process.

## How to Use This Skill

### Step 1: Check for Existing BrandScript

Before starting, check if a BrandScript already exists at `context/core/storybrand-brandscript.json`. If it exists, ask the user:

"I found an existing StoryBrand BrandScript. Would you like to:
1. Create a completely new BrandScript
2. Update the existing one (I'll show you current values and ask what to change)"

### Step 2: Conduct Conversational Interview

Ask the following questions **ONE AT A TIME** in a conversational manner. Wait for the user's response before proceeding to the next question. Use the AskUserQuestion tool for questions with common options.

**IMPORTANT:** Always use AskUserQuestion tool. Never ask multiple questions at once.

---

#### Section A: The Hero (Your Customer)

**Question 1: Customer Identity**
Use AskUserQuestion:
- Question: "Let's start by identifying your ideal customer. Who are they?"
- Header: "Customer"
- Options:
  - "Small business owners" - Entrepreneurs running their own companies
  - "Enterprise/Corporate" - Larger organizations with established teams
  - "Specific industry" - A particular vertical (describe in Other)
  - Other

**Question 2: Customer Desire**
Ask directly: "What does your ideal customer want? What tangible outcome are they seeking?"

**Question 3: Transformation**
Use AskUserQuestion:
- Question: "What transformation do you help customers achieve? What's their 'before' and 'after' state?"
- Header: "Transformation"
- Options:
  - "Struggling to Thriving" - From overwhelmed/stuck to organized and growing
  - "Invisible to Recognized" - From unknown to market leader
  - "Confused to Clear" - From uncertain to confident direction
  - Other (describe their specific transformation)

**Question 3b: Other Decision Makers (Optional)**
Ask directly: "Does your ideal customer need to convince someone else before acting? (e.g., spouse, business partner, board, committee) If so, who?"

**Question 3c: Potential Objections (Optional)**
Ask directly: "What are the most common reasons people say 'No' to you? What hesitations or objections do you hear?"

---

#### Section B: The Problem

**Question 4: External Problem**
Ask directly: "What's the tangible, external problem your customers face every day? What practical challenge are they dealing with?"

**Question 4b: The Villain**
Ask directly: "What is the single root cause of all your customer's problems? Think of this as 'the villain' in their story - the enemy you both fight against."

*Example villains: "Outdated technology", "Confusing regulations", "Time scarcity", "Poor communication"*

**Question 5: Internal Problem**
Use AskUserQuestion:
- Question: "How does this problem make your customers FEEL?"
- Header: "Emotions"
- Options:
  - "Frustrated and overwhelmed" - Too much to handle, constant stress
  - "Embarrassed or behind" - Feeling like they're falling behind competitors
  - "Anxious and uncertain" - Worried about the future, unclear path
  - Other (describe specific emotions)
- multiSelect: true (allow multiple selections)

**Question 6: Philosophical Problem**
Ask directly: "Why is this situation just WRONG? Complete this sentence: 'It shouldn't be so hard to...' or 'Everyone deserves...'"

---

#### Section C: The Guide (Your Business)

**Question 7: Empathy**
Ask directly: "How do you understand your customers' struggle? Complete this: 'We understand what it's like to...'"

**Question 8: Authority**
Ask directly: "What credentials, experience, or results make you qualified to help them? (years of experience, number of clients, certifications, results achieved)"

**Question 9: Authority Stats**
Ask directly: "Share some specific numbers that build trust:
- How many years of experience?
- How many clients/customers served?
- What's your success rate or satisfaction percentage?
- Any other impressive stats?"

---

#### Section D: The Plan (3 Steps)

**Question 10: Step 1**
Ask directly: "What's the FIRST thing a customer does to work with you? (Schedule a call, fill out a form, sign up, etc.) Give me a short title and brief description."

**Question 11: Step 2**
Ask directly: "What happens NEXT? What do you do for them after they take that first step? Give me a short title and brief description."

**Question 12: Step 3**
Ask directly: "What's the final RESULT or VICTORY? What success do they achieve? Give me a short title and brief description."

**Question 12b: Agreement Plan (Optional)**
Ask directly: "What guarantees or commitments can you make to alleviate fears about working with you? List 2-3 promises that address common objections."

*Example agreements: "Same-day response guarantee", "No hidden fees", "100% satisfaction or money back", "Clear communication at every step"*

---

#### Section E: Call to Action

**Question 13: Primary CTA**
Use AskUserQuestion:
- Question: "What's the main action you want website visitors to take?"
- Header: "Primary CTA"
- Options:
  - "Get a Free Quote" - Request pricing/proposal
  - "Schedule a Call" - Book a consultation
  - "Start Free Trial" - Try the product
  - Other (custom CTA text)

**Question 14: Transitional CTA**
Use AskUserQuestion:
- Question: "For visitors not ready to buy, what free resource can you offer?"
- Header: "Lead Magnet"
- Options:
  - "Free Consultation" - 15-30 minute discovery call
  - "Free Guide/Ebook" - Downloadable PDF resource
  - "Free Assessment" - Audit or evaluation
  - Other (describe your offer)

**Question 15: Contact Info**
Ask directly: "What's the best phone number and email for your business?"

---

#### Section F: Success

**Question 16: Success Vision**
Ask directly: "Describe what life/business looks like AFTER working with you. What does success look like for your customers?"

**Question 17: Key Benefits**
Ask directly: "What are the TOP 3 outcomes or benefits your customers achieve? List them as short, punchy statements."

---

#### Section G: Stakes (Failure)

**Question 18: Stakes**
Ask directly: "What happens if your ideal customer DOESN'T take action? What opportunities do they miss? How does the problem get worse over time? Give me 3 potential negative outcomes."

---

#### Section H: Elevator Pitch Workflow

After collecting all the core answers, guide the user through creating their elevator pitch progression:

**Step H1: Generate Long Elevator Pitch**
Combine all elements into a comprehensive narrative paragraph. Include:
- After Transformation (goals/desires)
- Character Needs (what they need from you)
- External, Internal, Philosophical Problems
- Empathy + Authority Statements
- Process Plan (3 steps)
- Agreement Plan (if provided)
- Direct + Transitional CTAs
- Avoids Failure (stakes)
- Ends in Success (benefits)

Present the generated long pitch and ask: "Here's your complete elevator pitch. Does this capture your value proposition accurately?"

**Step H2: Condense to 3-4 Sentences**
Help condense to the formula: **Problem → Solution → Results**

Ask: "Now let's condense this. Can you summarize in 3-4 sentences following this structure:
- **The Main Problem:** What's the core pain point?
- **Your Solution:** How do you solve it?
- **The Awesome Results:** What outcome do they get?"

**Step H3: Create Main Headline**
Ask: "Finally, let's distill this to a headline of 6 words or less. What's the single most powerful promise you make?"

**Step H4: Company Tagline (Optional)**
Ask: "Would you like to create a company tagline for your About page? This should be memorable and capture your brand essence."

---

### Step 3: Generate Copy

After collecting all answers, generate website copy for each section:

1. **Headline** - Aspirational, customer-focused (what they become/achieve)
2. **Subheadline** - How you help them get there
3. **Problem Section** - Titles and descriptions for external, internal, philosophical + The Villain
4. **Value Stack** - 3 benefit cards with titles and descriptions
5. **Guide Section** - Empathy statement + authority statement
6. **Plan Section** - Heading + 3 steps with titles and descriptions
7. **Agreement Section** (if provided) - Heading + 3 guarantees/commitments
8. **Explanatory Paragraph** - Problem → Solution → Success in one paragraph
9. **Stakes Section** - Heading + 3 stakes with titles and descriptions
10. **Elevator Pitch** - Long version, condensed version, headline, and tagline
11. **Final CTA** - Closing headline and subheading

### Step 4: Present and Refine

Display all generated copy to the user in an organized format. Ask:

"Here's your generated StoryBrand copy. Would you like to:
1. Save it as-is
2. Refine any specific sections
3. Regenerate with different emphasis"

Iterate until the user is satisfied.

### Step 5: Save Output

Save the complete BrandScript to `context/core/storybrand-brandscript.json` using the schema in `references/storybrand-output-schema.json`.

Include:
- `_instructions`: Brief description of the file's purpose
- `_metadata`: Created/updated timestamps, version
- `answers`: All raw user responses organized by section
- `generated_copy`: All generated copy ready for use in components

Display confirmation: "Your StoryBrand BrandScript has been saved to `context/core/storybrand-brandscript.json`. You can use this to populate your homepage wireframe components."

## Key Considerations

- **Tone**: Keep the conversation natural and encouraging. Explain why each question matters.
- **Flexibility**: If a user doesn't have an answer, note it as empty and continue.
- **Copy Quality**: Generated copy should be concise, customer-focused, and action-oriented.
- **Iteration**: Always offer to refine sections - great copy takes iteration.

## Bundled Resources

- `references/storybrand-framework.md` - Complete StoryBrand framework documentation
- `references/storybrand-output-schema.json` - JSON schema for output file
- `assets/templates/brandscript-template.md` - Template for displaying results
- `assets/templates/Brand Story - [TEMPLATE].pdf` - Professional worksheet from Web Design Shop Inc. with enhanced 5-step methodology

## Related Files

- **Client Worksheet**: `knowledge/worksheets/storybrand-client-worksheet.md`
- **Output Location**: `context/core/storybrand-brandscript.json`
- **Wireframe Components**: `frontend/components/storybrand/`
