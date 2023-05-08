import React, { useEffect, useState } from 'react';
import { Auth, Hub } from 'aws-amplify';
import { CognitoUser } from '@aws-amplify/auth';
import { Button } from '@aws-amplify/ui-react';

import '@aws-amplify/ui-react/styles.css';

const App: React.FC = () => {
  const [user, setUser] = useState<CognitoUser | null>(null);
  const [, setCustomState] = useState(null);

  useEffect(() => {
    const unsubscribe = Hub.listen('auth', ({ payload: { event, data } }) => {
      switch (event) {
        case 'signIn':
          setUser(data);
          break;
        case 'signOut':
          setUser(null);
          break;
        case 'customOAuthState':
          setCustomState(data);
      }
    });

    Auth.currentAuthenticatedUser()
      .then(currentUser => {
        console.log(currentUser);
        setUser(currentUser);
      })
      .catch(() => console.log('Not signed in'));

    return unsubscribe;
  }, []);

  return (
    <div>
      {
        user
          ? (
            <>
              <Button onClick={() => Auth.signOut()}>Sign Out</Button>
              <dl>
                <dt>Username</dt>
                <dd>{user.getUsername()}</dd>
              </dl>
            </>
          )
          : (
            <>
              <Button onClick={() => Auth.federatedSignIn()}>Open Hosted UI</Button>
              <Button onClick={() => Auth.federatedSignIn({ customProvider: 'Github' })}>Github</Button>
            </>
          )
      }
    </div>
  );
};

export default App;
