import type { ChatSettings } from './chat-settings';
import type { StreamActions } from './stream/stream-provider';

type Question = { chatId: string; question: string; locale: 'de' | 'en' };

/** Sends the next question to the chosen model, or to both models of the comparison. */
export function sendQuestion(
  streams: Pick<StreamActions, 'ask' | 'compare'>,
  settings: Pick<ChatSettings, 'model' | 'compare' | 'compareModel' | 'answerOptions'>,
  { chatId, question, locale }: Question,
): Promise<boolean> {
  const { model, compareModel } = settings;
  if (!model) return Promise.resolve(false);
  if (settings.compare && compareModel) {
    return streams.compare({
      chatId,
      question,
      locale,
      lanes: [
        { model, ...settings.answerOptions(model) },
        { model: compareModel, ...settings.answerOptions(compareModel) },
      ],
    });
  }
  return streams.ask({ chatId, question, model, locale, ...settings.answerOptions(model) });
}
