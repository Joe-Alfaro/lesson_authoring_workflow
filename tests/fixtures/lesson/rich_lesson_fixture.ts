// A lesson that uses every block type and every optional field of the D-016 schema, with ids on
// every section, part and block. The M3 editor round trip (src/editor) must reproduce it exactly.
// The prose is invented placeholder text.
import type { LessonContent } from '../../../src/lesson/schema'

/** Focus standards of the rich fixture (real grade 6 codes, so the e2e seed resolves them). */
export const RICH_FOCUS = ['RL.6.1', 'RL.6.2']

export function richLessonContent(): LessonContent {
  return {
    schemaVersion: 1,
    frontMatter: {
      unitTitle: 'Placeholder Unit',
      number: 4,
      arc: 'Investigation 1',
      type: 'core_reading',
      title: 'Placeholder Lesson: Every Block',
      durationMinutes: 50,
      focusStandards: [...RICH_FOCUS],
      supportingStandards: ['L.6.4', 'LIB.6.2.1.a'],
      eldStandards: [
        { code: 'ELD.PI.6.6', levels: ['Em', 'Ex', 'Br'] },
        { code: 'ELD.PII.6.5', levels: ['Ex'] },
      ],
      texts: [
        {
          title: 'Placeholder Anchor Novel',
          source: 'Placeholder Author',
          kind: 'novel',
          pages: 'pp. 1–8',
        },
        { title: 'Placeholder Short Myth', kind: 'short_form' },
      ],
    },
    body: {
      title: 'Placeholder Lesson: Every Block',
      objectives: {
        content: 'Students will cite **one detail** to support a claim about the narrator.',
        language: 'Students will use *This suggests that* to connect a detail to an inference.',
        foundationalSkills: 'Students will use a root to work out a word’s meaning.',
      },
      essentialQuestions: [
        'Why do people tell stories to explain the world?',
        'How do retellings change over time?',
      ],
      connections: {
        knowledgeBuilding: 'Students add to what they know about the unit topic.',
        enduringUnderstanding: 'Readers support their ideas with evidence.',
        futureLessons: 'Lesson 5 turns these inferences into a paragraph.',
        unitPerformanceTask: 'Explaining an emerging theme with evidence.',
      },
      vocabulary: {
        addressed: [
          { term: 'claim', definition: 'An idea a reader states and supports.' },
          { term: 'inference', definition: 'A conclusion drawn from details.' },
        ],
        support: [{ term: 'detail', definition: 'A small piece of information in a text.' }],
      },
      materials: ['Anchor text', 'Chart paper & markers', 'Sticky notes for <annotation>'],
      sections: [
        {
          id: 'sec-launch',
          kind: 'launch',
          minutes: 5,
          purpose: 'Students predict what kind of hero the narrator might become.',
          parts: [
            {
              id: 'part-launch',
              standards: [],
              blocks: [
                {
                  type: 'routine',
                  id: 'b-routine',
                  routine: 'turn_and_talk',
                  label: 'Turn and Talk',
                },
                {
                  type: 'say',
                  id: 'b-say',
                  text: 'Today we meet a narrator who says he is **not** a normal kid.',
                },
                {
                  type: 'ask',
                  id: 'b-ask',
                  question: 'What might a story about a *problem kid* be about?',
                  exemplar: 'It could be about a kid who proves everyone wrong.',
                },
                {
                  type: 'connection',
                  id: 'b-connection',
                  text: 'Remind students of the myth they read in Lesson 3.',
                },
              ],
            },
          ],
        },
        {
          id: 'sec-lab',
          kind: 'literacy_lab',
          minutes: 10,
          purpose: 'Students practice linking evidence to an inference.',
          parts: [
            {
              id: 'part-lab',
              label: 'Language Study',
              title: 'This suggests that',
              standards: ['L.6.4'],
              minutes: 10,
              purpose: 'Practice the sentence frame before reading.',
              blocks: [
                { type: 'teach', id: 'b-teach', title: 'Model the frame' },
                { type: 'paragraph', id: 'b-paragraph', text: 'Write the frame on chart paper.' },
                {
                  type: 'display',
                  id: 'b-display',
                  label: 'Chart',
                  text: 'The text says ___. This suggests that ___.',
                },
                {
                  type: 'sentence_starter',
                  id: 'b-starter',
                  text: 'One detail that stood out to me is ___.',
                },
                {
                  type: 'list',
                  id: 'b-list',
                  intro: 'Steps for partners:',
                  ordered: true,
                  items: ['Read the sentence aloud.', 'Name the detail.', 'Say the inference.'],
                },
                {
                  type: 'table',
                  id: 'b-table',
                  caption: 'Detail and inference',
                  headers: ['Detail', 'Inference'],
                  rows: [
                    ['He warns readers to stop.', 'He thinks his life is dangerous.'],
                    ['He lists his old schools.', ''],
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'sec-action',
          kind: 'learning_in_action',
          minutes: 30,
          purpose: 'Students cite details to support claims about the narrator.',
          parts: [
            {
              id: 'part-a',
              label: 'A',
              title: 'Reading the opening with pause points',
              standards: ['RL.6.1', 'L.6.4'],
              minutes: 18,
              purpose: 'Students cite what the narrator says about himself.',
              blocks: [
                {
                  type: 'teacher_tip',
                  id: 'b-tip',
                  text: 'Keep the talk on how the narrator sees himself.',
                },
                {
                  type: 'directions',
                  id: 'b-directions',
                  text: 'Mark any sentence where the narrator tells you how he feels.',
                },
                {
                  type: 'pulse_check',
                  id: 'b-pulse',
                  standards: ['RL.6.1', 'L.6.4'],
                  stem: 'Which meaning of *probation* fits best?',
                  options: [
                    {
                      text: 'A school award',
                      correct: false,
                      rationale: 'Ignores the context of trouble.',
                    },
                    {
                      text: 'A trial period',
                      correct: true,
                      rationale: 'Fits a student on one more chance.',
                    },
                    {
                      text: 'A final exam',
                      correct: false,
                      rationale: 'Nothing in the text points to a test.',
                    },
                    {
                      text: 'A family trip',
                      correct: false,
                      rationale: 'Probation means staying and being watched.',
                    },
                  ],
                },
                {
                  type: 'check_for_understanding',
                  id: 'b-cfu',
                  standards: ['RL.6.1'],
                  prompt: 'Listen for one detail and one inference from each pair.',
                  lookFors: ['Names a detail', 'Uses the frame'],
                },
                {
                  type: 'eld_instructions',
                  id: 'b-eld',
                  purpose: 'Support students in naming the narrator’s feelings.',
                  languageFocus: ['frustrated', 'embarrassed'],
                  beforeActivity: 'Have partners point to the sentence they starred.',
                  moves: ['Model one inference aloud.', 'Ask partners to try one.'],
                  recasts: [
                    { studentSaid: 'He is mad.', academic: 'He sounds frustrated with adults.' },
                  ],
                  frames: ['The narrator says ___. This suggests that ___.'],
                  assetMoves: ['Invite students to use a home-language word first.'],
                  leveledFrames: {
                    emerging: 'He feels ___.',
                    expanding: 'He feels ___ because ___.',
                    bridging: 'This suggests that he feels ___ because ___.',
                  },
                  watchFor: [
                    {
                      trigger: 'Students retell instead of inferring.',
                      prompt: 'What does that detail show?',
                    },
                  ],
                  successCriteria: ['Each student uses the frame with one detail.'],
                },
                {
                  type: 'student_support',
                  id: 'b-support',
                  title: 'Additional student support',
                  rows: [
                    {
                      kind: 'struggling',
                      focus: 'Finding evidence',
                      tryThis: 'Give a page number and a starter.',
                    },
                    {
                      kind: 'extension',
                      focus: '',
                      tryThis: 'Find a sarcastic sentence and explain it.',
                    },
                  ],
                },
              ],
            },
            {
              id: 'part-b',
              label: 'B',
              title: 'Writing about the narrator’s fears',
              standards: ['RL.6.1', 'RL.6.2'],
              minutes: 12,
              blocks: [
                {
                  type: 'rubric',
                  id: 'b-rubric',
                  title: 'Short response rubric',
                  prompt: 'How does the opening set the narrator up as a hero?',
                  levels: ['Beginning', 'Developing', 'Meeting'],
                  criteria: [
                    {
                      name: 'Evidence',
                      standard: 'RL.6.1',
                      descriptors: ['No detail', 'A loose detail', 'A precise detail'],
                    },
                    {
                      name: 'Theme',
                      descriptors: ['Retells', 'Names an idea', 'Explains an idea'],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'sec-lookback',
          kind: 'look_back',
          minutes: 5,
          purpose: 'Students reflect on how sure they are of their inference.',
          parts: [
            {
              id: 'part-lookback',
              standards: [],
              blocks: [
                {
                  type: 'reflection',
                  id: 'b-reflection',
                  standards: ['RL.6.1'],
                  prompt: 'Rate yourself from 1 to 5.',
                  questions: ['How sure are you of your inference?', 'What would make you surer?'],
                },
              ],
            },
          ],
        },
      ],
      homework: {
        intro: 'Have students take the novel home.',
        tasks: ['Read and annotate pp. 9–15.', 'Mark two places where the tone changes.'],
        teacherTip: 'Collect annotations at the door.',
      },
    },
  }
}
