import { Component } from 'react'
import { captureError } from '../lib/monitoring'
import OutageScreen from './OutageScreen'

// Top-level safety net. A render error anywhere below this used to blank the
// whole screen with no recovery. Now we catch it, report it, and show the shared
// branded outage screen (its "Try again" reloads).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    captureError(error, { componentStack: info?.componentStack })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return <OutageScreen />
  }
}
