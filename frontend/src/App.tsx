import * as React from 'react';
import {
  ChakraProvider,
  Box,
  Text,
  Grid,
  theme,
  IconButton,
} from '@chakra-ui/react';
import { FaPlus } from 'react-icons/fa';
import ColorModeSwitcher from './ColorModeSwitcher';
import Connections from './components/Connections';

export default function App() {
  return (
    <ChakraProvider theme={theme}>
      <Box fontSize="xl">
        <Grid minH="100vh" p={4}>
          <ColorModeSwitcher justifySelf="flex-end" />
          <Text align="center" fontSize="5xl">
            Connections
            &nbsp;
            <IconButton aria-label="Add connection" size="lg" icon={<FaPlus />} />
          </Text>
          <Connections />
        </Grid>
      </Box>
    </ChakraProvider>
  );
}
