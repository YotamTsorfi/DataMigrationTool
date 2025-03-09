import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  SectionContainer,
  InputContainer,
  InputLabel,
  Button,
} from "./BatchProcessorStyles";

interface ConfigItem {
  ConfigKey: string;
  ConfigValue: string;
  Description: string;
  LastUpdated: string;
}

const ConfigPanel: React.FC = () => {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const response = await axios.get("http://localhost:3001/config");
      setConfigs(response.data);
    } catch (error) {
      console.error("Error fetching configuration:", error);
      toast.error("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (index: number, value: string) => {
    const newConfigs = [...configs];
    newConfigs[index].ConfigValue = value;
    setConfigs(newConfigs);
  };

  const saveConfig = async (config: ConfigItem) => {
    try {
      await axios.put(`http://localhost:3001/config/${config.ConfigKey}`, {
        value: config.ConfigValue,
      });
      toast.success(`${config.ConfigKey} updated successfully`);
    } catch (error) {
      console.error("Error updating config:", error);
      toast.error(`Failed to update ${config.ConfigKey}`);
    }
  };

  return (
    <SectionContainer>
      <h2>System Configuration</h2>
      {loading ? (
        <p>Loading configurations...</p>
      ) : (
        <>
          {configs.map((config, index) => (
            <InputContainer key={config.ConfigKey}>
              <InputLabel>
                {config.Description || config.ConfigKey}:
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input
                    type="text"
                    value={config.ConfigValue}
                    onChange={(e) => handleConfigChange(index, e.target.value)}
                  />
                  <Button
                    onClick={() => saveConfig(config)}
                    style={{ marginLeft: "10px" }}
                  >
                    Save
                  </Button>
                </div>
              </InputLabel>
              <small>
                Last updated: {new Date(config.LastUpdated).toLocaleString()}
              </small>
            </InputContainer>
          ))}
        </>
      )}
    </SectionContainer>
  );
};

export default ConfigPanel;