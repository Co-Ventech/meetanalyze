import { MEETING_LINKS } from "../common/constants";

export async function checkLinkConnection() {

  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  switch(MEETING_LINKS){
  }

  if (!tab?.id || !tab.url?.startsWith(MEETING_LINKS.GOOGLE_MEET.URL)) {
    return {
      connected: false,
      message: `${MEETING_LINKS.GOOGLE_MEET.NAME}`
    };
  }

  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      type: 'MEET_CONNECTION_CHECK'
    });

    return response;
  } catch (error) {
    return {
      connected: false,
      message: 'Extension content script is not responding'
    };
  }
}