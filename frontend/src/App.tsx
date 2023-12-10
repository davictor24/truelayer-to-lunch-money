import * as React from 'react';
import { useRef, useState, useEffect } from 'react';
import {
  ChakraProvider,
  Box,
  Text,
  Grid,
  theme,
  IconButton,
  useDisclosure,
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Input,
  useToast,
} from '@chakra-ui/react';
import { FaPlus } from 'react-icons/fa';
import ColorModeSwitcher from './components/ColorModeSwitcher';
import Connections from './components/Connections';
import truelayerService, { Connection } from './services/truelayer';

export default function App() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const initialRef = useRef(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [newConnectionName, setNewConnectionName] = useState<string>('');
  const toast = useToast();

  const getConnections = (showToast = false) => {
    const promise = async () => {
      setConnections(await truelayerService.getConnections());
    };

    if (showToast) {
      toast.promise(promise(), {
        success: { title: 'Connections fetched successfully', description: 'Looks great' },
        error: (err) => ({ title: 'An error occurred', description: err.message }),
        loading: { title: 'Fetching connections...', description: 'Please wait' },
      });
    } else {
      promise();
    }
  };

  const connect = (name: string) => {
    onClose();
    toast.promise(truelayerService.connect(name), {
      success: { title: 'Preparing to connect...', description: 'You will be redirected to TrueLayer' },
      error: (err) => ({ title: 'An error occurred', description: err.message }),
      loading: { title: 'Preparing to connect...', description: 'Please wait' },
    });
  };

  const disconnect = (name: string) => {
    const promise = truelayerService.disconnect(name);
    toast.promise(promise, {
      success: { title: 'Disconnected successfully', description: 'Looks great' },
      error: (err) => ({ title: 'An error occurred', description: err.message }),
      loading: { title: 'Disconnecting...', description: 'Please wait' },
    });
    promise.then(() => getConnections());
  };

  const sync = (name: string) => {
    const promise = truelayerService.sync(name);
    toast.promise(promise, {
      success: { title: 'Sync successful', description: 'Looks great' },
      error: { title: 'Sync failed', description: 'Something went wrong' },
      loading: { title: 'Syncing...', description: 'Please wait' },
    });
    promise.then(() => getConnections());
  };

  useEffect(() => {
    getConnections(true);
  }, []);

  return (
    <ChakraProvider theme={theme}>
      <Box fontSize="xl">
        <Grid minH="100vh" p={4}>
          <ColorModeSwitcher justifySelf="flex-end" />
          <Text align="center" fontSize="5xl">
            Connections
            &nbsp;
            <IconButton aria-label="Add connection" size="lg" onClick={onOpen} icon={<FaPlus />} />
          </Text>
          {connections.length > 0
            ? (
              <Connections
                connections={connections}
                connect={connect}
                disconnect={disconnect}
                sync={sync}
              />
            ) : <Text align="center" fontSize="md">No connections</Text>}
        </Grid>
      </Box>
      {isOpen
        && (
          <Modal
            initialFocusRef={initialRef}
            onClose={onClose}
            isOpen={isOpen}
            isCentered
            closeOnOverlayClick={false}
          >
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>New bank connection</ModalHeader>
              <ModalCloseButton />
              <ModalBody>
                <Input
                  ref={initialRef}
                  onChange={(e) => setNewConnectionName(e.currentTarget.value)}
                  placeholder="Name e.g. 'My Monzo account'"
                />
              </ModalBody>
              <ModalFooter>
                <Button onClick={() => connect(newConnectionName)}>Next</Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
    </ChakraProvider>
  );
}
