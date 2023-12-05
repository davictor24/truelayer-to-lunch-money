import * as React from 'react';
import { Fragment } from 'react';
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
} from '@chakra-ui/react';
import { FaChevronRight, FaRegClock } from 'react-icons/fa';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface Connection {
  id: string;
  name: string;
  expiresAt: number;
  provider: ConnectionProvider
}

interface ConnectionProvider {
  name: string;
  logoURL: string;
}

const connections: Connection[] = [
  {
    id: 'aaa',
    name: 'Victor\'s Monzo account',
    expiresAt: 1709591611688,
    provider: {
      name: 'Monzo',
      logoURL: 'https://truelayer-client-logos.s3-eu-west-1.amazonaws.com/banks/banks-icons/ob-monzo-icon.svg',
    },
  },
  {
    id: 'bbb',
    name: 'Peipei\'s Monzo account',
    expiresAt: 1706135611688,
    provider: {
      name: 'Monzo',
      logoURL: 'https://truelayer-client-logos.s3-eu-west-1.amazonaws.com/banks/banks-icons/ob-monzo-icon.svg',
    },
  },
];

export default function Connections() {
  return (
    <Container maxW="5xl" p={{ base: 5, md: 10 }}>
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
                      {`Expires ${dayjs(new Date()).to(new Date(connection.expiresAt))}`}
                    </Text>
                  </HStack>
                </Flex>
              </Stack>
              <Flex p={4}>
                <Icon as={FaChevronRight} w={5} h={5} color="blue.400" />
              </Flex>
            </Flex>
            {connections.length - 1 !== index && <Divider m={0} />}
          </Fragment>
        ))}
      </VStack>
    </Container>
  );
}
