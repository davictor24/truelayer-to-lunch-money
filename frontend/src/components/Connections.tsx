import * as React from 'react';
import { Fragment, useState } from 'react';
import {
  Container,
  Flex,
  Stack,
  VStack,
  Icon,
  Divider,
  useColorModeValue,
  Avatar,
  Text,
  HStack,
  useDisclosure,
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  useToast,
} from '@chakra-ui/react';
import { FaRegClock } from 'react-icons/fa';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface Connection {
  id: string;
  name: string;
  lastSynced: number;
  expiresAt: number;
  provider: ConnectionProvider;
}

interface ConnectionProvider {
  name: string;
  logoURL: string;
}

const connections: Connection[] = [
  {
    id: 'aaa',
    name: 'Victor\'s Monzo account',
    lastSynced: Date.now() - 10 * 60 * 1000,
    expiresAt: 1709591611688,
    provider: {
      name: 'Monzo',
      logoURL: 'https://truelayer-client-logos.s3-eu-west-1.amazonaws.com/banks/banks-icons/ob-monzo-icon.svg',
    },
  },
  {
    id: 'bbb',
    name: 'Peipei\'s Monzo account',
    lastSynced: Date.now() - 15 * 60 * 1000,
    expiresAt: 1706135611688,
    provider: {
      name: 'Monzo',
      logoURL: 'https://truelayer-client-logos.s3-eu-west-1.amazonaws.com/banks/banks-icons/ob-monzo-icon.svg',
    },
  },
];

export default function Connections() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [openedConnection, setOpenedConnection] = useState<Connection | undefined>();
  const toast = useToast();

  const handleOpen = (connectionIdx: number) => {
    setOpenedConnection(connections[connectionIdx]);
    onOpen();
  };

  const sync = () => {
    const dummyPromise = new Promise((resolve) => {
      setTimeout(() => resolve(200), 2000);
    });
    toast.promise(dummyPromise, {
      success: { title: 'Sync successful', description: 'Looks great' },
      error: { title: 'Sync failed', description: 'Something went wrong' },
      loading: { title: 'Syncing...', description: 'Please wait' },
    });
  };

  const auth = () => { };

  return (
    <Container p={{ base: 5, md: 10 }}>
      <VStack
        boxShadow={useColorModeValue(
          '2px 6px 8px rgba(160, 174, 192, 0.6)',
          '2px 6px 8px rgba(9, 17, 28, 0.9)',
        )}
        bg={useColorModeValue('gray.100', 'gray.800')}
        rounded="md"
        overflow="hidden"
        spacing={0}
      >
        {connections.map((connection, index) => (
          <Fragment key={connection.id}>
            <Flex
              w="100%"
              justify="space-between"
              alignItems="center"
              cursor="pointer"
              _hover={{ bg: 'gray.200' }}
              _dark={{ _hover: { bg: 'gray.700' } }}
              onClick={() => handleOpen(index)}
            >
              <Stack spacing={0} direction="row" alignItems="center">
                <Flex p={4}>
                  <Avatar size="md" name={connection.provider.name} src={connection.provider.logoURL} />
                </Flex>
                <Flex direction="column" p={2}>
                  <Text
                    color="black"
                    _dark={{ color: 'white' }}
                    fontSize={{ base: 'sm', sm: 'md', md: 'lg' }}
                    fontWeight="600"
                  >
                    {connection.name}
                  </Text>
                  <HStack>
                    <Icon as={FaRegClock} color="blue.400" />
                    <Text
                      color="gray.400"
                      _dark={{ color: 'gray.200' }}
                      fontSize={{ base: 'sm', sm: 'md' }}
                    >
                      {dayjs(new Date(connection.lastSynced)).from(new Date())}
                    </Text>
                  </HStack>
                </Flex>
              </Stack>
            </Flex>
            {connections.length - 1 !== index && <Divider m={0} />}
          </Fragment>
        ))}
      </VStack>
      {openedConnection
        && (
          <Modal onClose={onClose} isOpen={isOpen} isCentered closeOnOverlayClick={false}>
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>{openedConnection.name}</ModalHeader>
              <ModalCloseButton />
              <ModalBody>
                Last synced:&nbsp;
                {dayjs(new Date(openedConnection.lastSynced)).from(new Date())}
                <br />
                Expires:&nbsp;
                {dayjs(new Date()).to(new Date(openedConnection.expiresAt))}
              </ModalBody>
              <ModalFooter>
                <Stack direction="row">
                  <Button onClick={sync}>Sync</Button>
                  <Button onClick={auth}>Authenticate</Button>
                </Stack>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
    </Container>
  );
}
