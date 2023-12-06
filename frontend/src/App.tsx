import * as React from 'react';
import { useRef } from 'react';
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
} from '@chakra-ui/react';
import { FaPlus } from 'react-icons/fa';
import ColorModeSwitcher from './components/ColorModeSwitcher';
import Connections from './components/Connections';

export default function App() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const initialRef = useRef(null);

  const newConn = () => { };

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
          <Connections />
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
                <Input ref={initialRef} placeholder="Name e.g. 'My Monzo account'" />
              </ModalBody>
              <ModalFooter>
                <Button onClick={newConn}>Next</Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
    </ChakraProvider>
  );
}
