import { useState } from 'react';
import reactLogo from '@/assets/react.svg';
import wxtLogo from '/wxt.svg';
import './App.css';
import { checkLinkConnection } from '../utils/check-google-meet-connection';

function App() {

  const [status, setStatus] = useState('Checking...');

  const checkConnection = async () => {
    const result = await checkLinkConnection();

    setStatus(
      result.connected
        ? 'Connected to Google Meet'
        : result.message
    );
  };

  return (
    <>
      <div>

      </div>
      <h1>MeetLyst</h1>
    </>
  );
}

export default App;
