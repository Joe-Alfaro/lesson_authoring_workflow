// Hand-written lesson fixtures for the D-016 schema (src/lesson/schema.ts). The prose is invented
// placeholder text; nothing here comes from the example lessons on the review site.
//
// Each builder returns a fresh object, so tests can mutate it freely.
import type { LessonBody, LessonContent, LessonFrontMatter } from '../../../src/lesson/schema'

/** Focus and supporting standards the fixtures are written for (both are in the standards fixture). */
export const FIXTURE_FOCUS = ['RL.6.1']
export const FIXTURE_SUPPORTING = ['L.6.4']

function eldInstructions() {
  return {
    type: 'eld_instructions' as const,
    purpose: 'Students practice citing a detail from the text to support a claim.',
    languageFocus: ['Using **because** to connect a claim to a detail'],
    moves: ['Model one claim with a detail, then ask partners to build their own.'],
    frames: ['I think ___ because the text says ___.'],
    watchFor: [
      {
        trigger: 'A student names a detail but no claim.',
        prompt: 'Ask: What does that detail make you think about the character?',
      },
    ],
    successCriteria: ['Each student states one claim and one supporting detail.'],
  }
}

function studentSupport() {
  return {
    type: 'student_support' as const,
    rows: [
      {
        kind: 'struggling' as const,
        focus: 'Finding a detail',
        tryThis: 'Point to one page and ask the student to underline a single sentence.',
      },
      {
        kind: 'extension' as const,
        focus: '',
        tryThis: 'Ask the student to find a second detail that complicates the first.',
      },
    ],
  }
}

/** A 50-minute core reading lesson body: 5 Launch, 10 Literacy Lab, 30 Learning in Action, 5 Look Back. */
export function coreLessonBody(): LessonBody {
  return {
    title: 'Placeholder Lesson: Claims and Details',
    objectives: {
      content:
        'Students will cite one detail from the chapter to support a claim about a character.',
      language: 'Students will use **because** to connect a claim to a detail.',
      foundationalSkills: 'Students will read a short passage aloud with attention to pauses.',
    },
    essentialQuestions: ['Why do people tell stories to explain the world?'],
    connections: {
      knowledgeBuilding: 'Students add to what they know about the unit topic.',
      enduringUnderstanding: 'Readers support their ideas with evidence.',
      futureLessons: 'Later lessons build on citing evidence in writing.',
      unitPerformanceTask: 'The performance task asks students to support claims with evidence.',
    },
    vocabulary: {
      addressed: [{ term: 'claim', definition: 'An idea a reader states and supports.' }],
      support: [{ term: 'detail', definition: 'A small piece of information in a text.' }],
    },
    materials: ['Anchor text', 'Chart paper'],
    sections: [
      {
        kind: 'launch',
        minutes: 5,
        purpose: 'Students recall what they read last time.',
        parts: [
          {
            standards: [],
            blocks: [
              { type: 'routine', routine: 'turn_and_talk' },
              {
                type: 'say',
                text: 'Yesterday we met a new character. Turn and tell a partner one thing you remember.',
              },
              {
                type: 'ask',
                question: 'What is one thing you remember about the character?',
                exemplar: 'The character was nervous on the first day.',
              },
            ],
          },
        ],
      },
      {
        kind: 'literacy_lab',
        minutes: 10,
        purpose: 'Students practice reading aloud with attention to pauses.',
        parts: [
          {
            standards: ['L.6.4'],
            blocks: [
              {
                type: 'directions',
                text: 'Read the passage aloud with your partner, pausing at each period.',
              },
              { type: 'teacher_tip', text: 'Listen for one pair and share what they did well.' },
            ],
          },
        ],
      },
      {
        kind: 'learning_in_action',
        minutes: 30,
        purpose: 'Students cite details to support claims.',
        parts: [
          {
            label: 'A',
            title: 'Find a detail',
            standards: ['RL.6.1'],
            minutes: 15,
            blocks: [
              { type: 'teach', title: 'Model citing a detail' },
              { type: 'paragraph', text: 'Model one claim and one detail on chart paper.' },
              {
                type: 'ask',
                question: 'Which detail shows how the character feels?',
                exemplar: 'The text says the character could not stop tapping a pencil.',
              },
              eldInstructions(),
              studentSupport(),
            ],
          },
          {
            label: 'B',
            title: 'Check understanding',
            standards: ['RL.6.1', 'L.6.4'],
            minutes: 15,
            blocks: [
              {
                type: 'ask',
                question:
                  'What claim can you make about the character, and which detail supports it?',
                exemplar:
                  'The character is brave, because the text says they stepped forward first.',
              },
              {
                type: 'pulse_check',
                standards: ['RL.6.1'],
                stem: 'Which sentence best supports the claim that the character is nervous?',
                options: [
                  {
                    text: 'The character tapped a pencil all morning.',
                    correct: true,
                    rationale: 'This detail shows nervous behavior.',
                  },
                  {
                    // Longer than the correct option: the correct one isn't the longest (D-045 (4)).
                    text: 'The school was large, with long hallways and many classrooms.',
                    correct: false,
                    rationale: 'This describes the setting, not the character.',
                  },
                  {
                    text: 'It was a sunny day.',
                    correct: false,
                    rationale: 'The weather does not show a feeling.',
                  },
                  {
                    text: 'Lunch was at noon.',
                    correct: false,
                    rationale: 'This is a schedule detail.',
                  },
                ],
              },
              eldInstructions(),
              studentSupport(),
            ],
          },
        ],
      },
      {
        kind: 'look_back',
        minutes: 5,
        purpose: 'Students reflect on how they used evidence.',
        parts: [
          {
            standards: [],
            blocks: [
              {
                type: 'reflection',
                standards: [],
                prompt: 'Reflect on today using the reflection routine.',
                questions: ['I can support a claim with a detail from the text.'],
              },
            ],
          },
        ],
      },
    ],
    homework: { tasks: ['Read the next chapter.'] },
  }
}

/** A 50-minute flex day body: 5 Launch, 40 Learning in Action in three huddles, 5 Look Back. */
export function flexLessonBody(): LessonBody {
  const core = coreLessonBody()
  const huddle = (label: string) => ({
    label,
    title: `Skill practice ${label}`,
    standards: ['RL.6.1'],
    minutes: label === 'Huddle 1' ? 14 : 13,
    blocks: [
      {
        type: 'ask' as const,
        question: 'Which detail supports your claim?',
        exemplar: 'The detail on page two supports my claim.',
      },
      eldInstructions(),
      studentSupport(),
    ],
  })
  return {
    ...core,
    title: 'Placeholder Flex Day: Skill Huddles',
    objectives: { content: core.objectives.content, language: core.objectives.language },
    sections: [
      core.sections[0]!,
      {
        kind: 'learning_in_action',
        minutes: 40,
        purpose: 'Students practice a skill in small huddles.',
        parts: [huddle('Huddle 1'), huddle('Huddle 2'), huddle('Huddle 3')],
      },
      core.sections[3]!,
    ],
    homework: null,
  }
}

export function coreFrontMatter(): LessonFrontMatter {
  return {
    unitTitle: 'Placeholder Unit',
    number: 4,
    arc: 'Investigation 1',
    type: 'core_reading',
    title: 'Placeholder Lesson: Claims and Details',
    durationMinutes: 50,
    focusStandards: [...FIXTURE_FOCUS],
    supportingStandards: [...FIXTURE_SUPPORTING],
    eldStandards: [{ code: 'ELD.PI.6.6', levels: ['Em', 'Ex', 'Br'] }],
    texts: [{ title: 'Placeholder Anchor Novel', kind: 'novel', pages: 'pp. 1-8' }],
  }
}

export function coreLessonContent(): LessonContent {
  return { schemaVersion: 1, frontMatter: coreFrontMatter(), body: coreLessonBody() }
}

export function flexLessonContent(): LessonContent {
  return {
    schemaVersion: 1,
    frontMatter: {
      ...coreFrontMatter(),
      number: null,
      type: 'flex',
      title: 'Placeholder Flex Day',
    },
    body: flexLessonBody(),
  }
}
